> **首发于个人博客**：[航图笔记 nightchart.cn](https://nightchart.cn/singleton-reentrant-deadlock.html)（S-57 / S-52 / S-100 / 渲染引擎源码走读，持续更新）。CSDN 同步发布，转载请保留出处。

这篇不聊标准，聊一次真实的翻车。当时在给渲染引擎加一种新的数据图层，改动本身不复杂，编译一次通过，本地验证也正常。合入后的第二天早上，版本一起，程序直接"石化"：进程在，窗口白，没有崩溃报告，日志停在启动流程的某一行之后再无下文。

## 现象：不是崩溃，是"石化"

排查先从三个特征排除最常见的嫌疑：

- **没有崩溃报告、没有异常栈** → 不是空指针、越界那类硬崩
- **CPU 占用接近 0** → 不是死循环（死循环会吃满至少一个核）
- **日志断流** → 卡住的位置就在最后一行日志对应的下一步

"不干活但也不退出"，加上 CPU 安静，基本可以断定：**某个线程在等一把永远等不到的锁。**

## 十分钟定位：让线程栈说话

这种"石化"，最快的定位方式不是加日志重跑，而是**直接 attach 上去看线程栈**——卡住的线程此刻就站在案发现场，不需要复现。

主线程的栈（简化后）长这样：

```
  [等待中]  互斥量加锁 ...
  GetInstance()
  LayerManager::LayerManager()     ← 构造函数
  RefreshFineSource()
  GetInstance()                    ← 又一次
  OnMapReady()
  main()
```

栈里出现了**两帧 `GetInstance()`，中间夹着构造函数**。翻译成人话：外层的 `GetInstance()` 正在初始化这个单例、还没返回；而初始化过程中的构造函数里，又有一层代码伸手去要这个还没出生的单例。

把闭环画出来，原因基本就锁定了：

![构造期重入调用链示意](https://nightchart.cn/assets/fig4-deadlock-callchain.svg)

*图 1：构造函数内部再次调用 GetInstance()，请求回到还没完成的初始化守卫——自己等自己*

## 根因：构造函数里伸手拿"还没出生的自己"

出问题的代码模式，脱敏后长这样：

```cpp
class LayerManager {
public:
  static LayerManager& GetInstance() {
    static LayerManager inst;   // C++11 起：线程安全的"魔法静态"
    return inst;
  }

  LayerManager() {
    // 想着"开箱即用"，把刷新逻辑塞进了构造……
    RefreshFineSource();
  }

  void RefreshFineSource() {
    auto& self = GetInstance();  // 重入！此时初始化还没完成
    // ...
  }
};
```

关键在 `static LayerManager inst;` 这一行。C++11 起，局部静态变量的初始化是线程安全的：编译器会生成一个**初始化守卫**，第一个到达的线程把门关上开始构造，其他线程在门口排队。

那同一线程在初始化过程中再次进来呢？标准在这里写得毫不留情——**行为未定义**（[stmt.dcl]：如果控制流在变量初始化完成前递归地再入这条声明……）。而主流实现（MSVC / GCC / Clang）守卫的实现方式决定了：重入的线程，哪怕就是初始化线程自己，也会在门口等待。

于是：构造线程在等守卫放行，守卫在等构造完成。**没人动，进程石化。**

![magic static 守卫：并发安全，重入死锁](https://nightchart.cn/assets/fig5-guard-reentry.svg)

*图 2：同一个守卫，多线程并发是安全的，同线程重入就是死锁*

顺带把两个容易混淆的问题分清：这不是 static initialization order fiasco（跨编译单元全局变量的初始化顺序问题），那个是"谁先构造"的玄学；这里是**单例初始化过程中的重入**，确定性的死锁，每次必现——反而好抓。

## 修复：三层加固

**第一层：构造瘦身（治本）。** 构造函数只做成员初始化，所有"干活"的逻辑挪出去，改成显式两阶段：构造完成、对象可用之后，由初始化流程显式调 `Init()`。

**第二层：未就绪先暂存。** 现实里总有调用时机绕不开初始化窗口——异步线程、外部回调，你控制不了谁先到。对这类调用不再硬闯单例，而是先入队，初始化完成后按序补放。真实工程里"安装记录未就绪时暂存、就绪后补写"的改法就是这个思路。

**第三层：指针显式置空兜底。** 可能被其他线程读到的成员指针一律显式初始化为 `nullptr`，让外部的判空逻辑能快速跳过，而不是撞上一个"半初始化"的对象。

修复后的示意：

```cpp
class LayerManager {
public:
  static LayerManager& GetInstance() {
    static LayerManager inst;    // 构造函数里再无任何"重活"
    return inst;
  }

  void OnDataReady(const TileData& d) {
    std::lock_guard<std::mutex> lk(mtx_);
    if (!ready_) {               // 未就绪：先记账，不硬闯
      pending_.push_back(d);
      return;
    }
    Apply(d);
  }

  void FinishInit() {            // 初始化完成点（由 Init 流程调用）
    std::lock_guard<std::mutex> lk(mtx_);
    ready_ = true;
    for (auto& d : pending_) Apply(d);   // 按序补放
    pending_.clear();
  }

private:
  LayerManager() = default;      // 瘦身：只初始化成员，指针一律 nullptr
  void Apply(const TileData& d);

  std::mutex mtx_;
  std::atomic<bool> ready_{false};
  std::vector<TileData> pending_;
};
```

![修复前后对比](https://nightchart.cn/assets/fig6-fix-compare.svg)

*图 3：构造只管"出生"，干活挪到显式阶段；初始化窗口内的调用先暂存、就绪后补放*

## 防复发清单

这类问题真正的麻烦在于：它经常**不发作**。改代码的时候恰好没人重入，一切正常；某天别处加了个调用时机，雷就响了。所以 review 时直接对照清单：

- 构造函数里**不调用任何可能回头拿单例/全局对象的函数**——间接的也算，顺着调用链往下多看两层
- 构造函数里不启动线程、不注册回调——回调可能在你构造完成之前就到达
- 构造函数里不打日志——日志系统自己往往也是单例
- 两个单例互相引用要格外警惕：A 的构造调 B，B 的构造调 A，结果取决于谁先进门
- "启动必现的挂死"先看线程栈再动手，不要先加日志重跑——有些问题重跑一次就复现不出来了

## 小结

- **现象识别**：无崩溃 + CPU 安静 + 日志断流 ≈ 在等一把永远等不到的锁，直接 attach 看线程栈
- **根因**：`static` 局部变量的初始化守卫**不防重入**——初始化线程自己再进来就是死锁（标准定义为未定义行为，主流实现的表现就是死锁）
- **药方**：构造瘦身两阶段、未就绪暂存补放、指针显式置空。三件事都不难，难的是写代码和 review 的时候能想起来

按计划，下一篇回到标准主线《S-57 数据解剖：把一个 ENC 文件拆给你看》；踩坑实录这个系列也会继续——真实的工程问题，比标准条文好消化。

---

我是夜航海图，做海图与地图渲染开发的工程师。博客「航图笔记」同步更新全部文章，欢迎 RSS 订阅。你也踩过单例的坑吗，评论区聊聊。

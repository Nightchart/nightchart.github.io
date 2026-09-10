(function(){
  var data=JSON.parse(document.getElementById("objl-data").textContent);
  var body=document.getElementById("objl-body"),q=document.getElementById("objl-search"),onlyC=document.getElementById("objl-common");
  function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")}
  // URL 深链：objl.html?objl=DEPARE 直接预填过滤
  try { var up=new URLSearchParams(location.search).get("objl"); if(up){q.value=up;} } catch(e){}
  function render(){
    var kw=(q.value||"").trim().toLowerCase(),common=onlyC.checked,rows=[];
    for(var i=0;i<data.length;i++){var o=data[i];
      if(common&&!o.common)continue;
      if(kw){var hay=(o.a+" "+o.n+" "+o.cn+" "+o.c).toLowerCase();if(hay.indexOf(kw)<0)continue;}
      rows.push(o);
    }
    var html="";
    for(var j=0;j<rows.length;j++){var o2=rows[j];
      var pills="";if(o2.p&&o2.p.length){for(var w=0;w<o2.p.length;w++)pills+="<span class='pill'>"+o2.p[w]+"</span>";}
      var atN=o2.at?o2.at.length:0;
      var atCell=atN?"<button class='pill at-btn' data-a='"+esc(o2.a)+"' type='button'>"+atN+" 个 ▾</button>":"—";
      html+="<tr class='objl-row' data-code='"+esc(o2.a)+"'><td class='c-num'>"+o2.c+"</td><td class='c-code'><strong>"+esc(o2.a)+"</strong>"+(o2.common?"<span class='star'>★</span>":"")+"</td><td>"+esc(o2.n)+"</td><td>"+esc(o2.cn||"—")+"</td><td>"+(pills||"—")+"</td><td>"+atCell+"</td></tr>";
      if(atN){var chips="";for(var k2=0;k2<atN;k2++)chips+="<a class='pill' href='attr.html?att="+encodeURIComponent(o2.at[k2])+"'>"+esc(o2.at[k2])+"</a> ";
        html+="<tr class='subrow hidden' data-for='"+esc(o2.a)+"'><td colspan='6'>"+chips+"</td></tr>";}
    }
    body.innerHTML=html||"<tr><td colspan='6' style='padding:1rem;color:var(--muted)'>无匹配</td></tr>";
    document.getElementById("objl-count").textContent=rows.length;
  }
  body.addEventListener("click",function(ev){
    var b=ev.target.closest(".at-btn");if(!b)return;
    var code=b.getAttribute("data-a");
    var sub=body.querySelector(".subrow[data-for='"+code+"']");
    if(sub)sub.classList.toggle("hidden");
  });
  q.addEventListener("input",render);onlyC.addEventListener("change",render);render();
  document.getElementById("objl-csv").addEventListener("click",function(){
    var lines=["OBJL,缩写,英文名称,中文,图元,属性清单"];
    document.querySelectorAll("#objl-body tr").forEach(function(tr){
      var tds=Array.prototype.map.call(tr.cells,function(td){var t=td.textContent.trim().replace(/s+/g," ");return '"'+t.replace(/"/g,'""')+'"';});
      if(tr.classList.contains("subrow"))lines.push('"","","","","",'+tds.slice(-1)[0]);
      else lines.push(tds.join(","));
    });
    var blob=new Blob(["﻿"+lines.join("
")],{type:"text/csv;charset=utf-8"});
    var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="s57-objectclasses.csv";
    document.body.appendChild(a);a.click();document.body.removeChild(a);setTimeout(function(){URL.revokeObjectURL(a.href)},3000);
  });
})();
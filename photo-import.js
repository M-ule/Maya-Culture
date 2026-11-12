/* Maya screenshot import. Local OCR with mandatory manual review. */
(()=>{'use strict';
const el=id=>document.getElementById(id);
const safeText=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BUILDINGS=[
 {id:'옥',name:'옥 채석장',aliases:['옥채석장','옥광산','옥채굴장'],production:'옥',group:'resources'},
 {id:'흑요석',name:'흑요석 채석장',aliases:['흑요석채석장','흑요석광산','흑요석채굴장'],production:'흑요석',group:'resources'},
 {id:'깃털',name:'새장',aliases:['새장','새 사육장','깃털사육장'],production:'깃털',group:'resources'},
 {id:'마스크',name:'마스크 작업장',aliases:['마스크작업장','마스크공방','마스크조각가'],production:'마스크',group:'products'},
 {id:'달력돌',name:'달력돌 작업장',aliases:['달력돌작업장','달력석작업장','달력돌공방','연대기편자'],production:'달력돌',group:'products'},
 {id:'단검',name:'단검 작업장',aliases:['단검작업장','단검공방','의식조각사'],production:'단검',group:'products'},
 {id:'머리장식',name:'머리장식 작업장',aliases:['머리장식작업장','머리장식공방'],production:'머리장식',group:'products'}
];
const STOCKS=['옥','흑요석','깃털','마스크','달력돌','단검','머리장식']
 .map(name=>({name,target:name,group:resourceOrder.includes(name)?'resources':'products'}));
let worker=null,busy=false,findings=[];
const STOCK_ALIASES={'조상마스크':'마스크','의식단검':'단검','옥원석':'옥'};
const clean=s=>String(s).replace(/\s|[·:：]/g,'');
function status(s,bad=false){el('photoStatus').textContent=s;el('photoStatus').classList.toggle('bad',bad);}
async function engine(){
 if(worker)return worker;
 if(!window.Tesseract)await new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  const fail=()=>{clearTimeout(timer);script.remove();reject(new Error('인식 엔진을 불러오지 못했습니다. 인터넷 연결을 확인하세요.'));};
  const timer=setTimeout(fail,20000);
  script.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  script.onload=()=>{clearTimeout(timer);resolve();};
  script.onerror=fail;
  document.head.append(script);
 });
 let timer,expired=false;
 try{
  worker=await new Promise((resolve,reject)=>{
   const fail=()=>{expired=true;reject(new Error('인식 엔진을 시작하지 못했습니다. 잠시 후 다시 분석해 주세요.'));};
   timer=setTimeout(fail,45000);
   window.Tesseract.createWorker('kor+eng',1,{errorHandler:fail}).then(w=>{
    if(expired)void w.terminate();else resolve(w);
   },fail);
  });
  return worker;
 }finally{clearTimeout(timer);}
}
function contrastImage(canvas){
 const copy=document.createElement('canvas');
 copy.width=canvas.width;copy.height=canvas.height;
 const ctx=copy.getContext('2d',{willReadFrequently:true});
 ctx.drawImage(canvas,0,0);
 const pixels=ctx.getImageData(0,0,copy.width,copy.height);
 for(let i=0;i<pixels.data.length;i+=4){
  const gray=.299*pixels.data[i]+.587*pixels.data[i+1]+.114*pixels.data[i+2];
  const value=Math.max(0,Math.min(255,(gray-128)*1.75+128));
  pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=value;
 }
 ctx.putImageData(pixels,0,0);
 return copy;
}
function quantity(s){if(String(s).trim()==='')return null;const n=parseStock(String(s).replace(/[Oo]/g,'0'));return n!==null&&Number.isSafeInteger(n)&&Math.abs(n)<=1e12?n:null;}
function matchBuilding(s){const text=clean(s);const exact=BUILDINGS.filter(b=>b.aliases.some(a=>text.includes(a))&&(!/호화|고급/.test(text)||/호화|고급/.test(b.name)));exact.sort((a,b)=>Math.max(...b.aliases.map(x=>x.length))-Math.max(...a.aliases.map(x=>x.length)));return exact[0]||null;}
function entry(id,label,value,extra={}){return {id,label,value,...extra};}
function stockNumber(text){
 const match=String(text).trim().match(/^[·:：]?\s*([0-9Oo][0-9Oo,]*(?:\.[0-9Oo]+)?\s*[KM]?)$/i);
 return match?quantity(match[1]):null;
}
// Tesseract builds can expose lines directly or nested inside block structure.
// Text-only fallback still allows whole-line matching and manual completion.
function recognizedLines(data){
 if(Array.isArray(data?.lines)&&data.lines.length)return data.lines;
 const lines=[];
 for(const block of Array.isArray(data?.blocks)?data.blocks:[]){
  for(const para of Array.isArray(block.paragraphs)?block.paragraphs:[]){
   for(const line of Array.isArray(para.lines)?para.lines:[]){
    const text=String(line.text||((line.words||[]).map(w=>w.text).join(' '))).trim();
    if(text)lines.push({text,bbox:line.bbox||null});
   }
  }
 }
 if(lines.length)return lines;
 return String(data?.text||'').split(/\r?\n/).map(text=>({text:text.trim(),bbox:null})).filter(line=>line.text);
}
function parseStockLines(lines){
 const out=[];
 for(const line of lines){
  const text=Object.entries(STOCK_ALIASES).reduce((value,[alias,name])=>value.startsWith(alias)?name+value.slice(alias.length):value,clean(line.text)),stock=STOCKS.filter(s=>text.startsWith(clean(s.name))).sort((a,b)=>b.name.length-a.name.length)[0];
  if(!stock)continue;
  let value=stockNumber(text.slice(clean(stock.name).length)),box=line.bbox;
  if(value===null&&box&&text===clean(stock.name)){
   const height=box.y1-box.y0;
   const nearby=lines.filter(({bbox:p,text})=>p&&stockNumber(text)!==null&&(
    (p.x0>=box.x1&&p.x0-box.x1<height*4&&Math.abs(p.y0-box.y0)<height*.6)||
    (p.y0>=box.y1&&p.y0-box.y1<height*1.5&&Math.abs(p.x0-box.x0)<height)
   )).sort((a,b)=>Math.hypot(a.bbox.x0-box.x0,a.bbox.y0-box.y0)-Math.hypot(b.bbox.x0-box.x0,b.bbox.y0-box.y0));
   if(nearby.length===1){value=stockNumber(nearby[0].text);box=nearby[0].bbox;}
  }
  if(value!==null)out.push(entry('stock_'+stock.target,stock.name+' 보유량',value,{kind:'stock',target:stock.target,box}));
 }
 return out;
}
function parseBuildingLines(lines,width,height){
 const out=[];
 for(const line of lines){const b=matchBuilding(line.text);if(!b)continue;const p=line.bbox||{},rh=Math.max(15,(p.y1||0)-(p.y0||0));
 const below=lines.filter(l=>l!==line&&l.bbox&&l.bbox.y0>=(p.y1||0)-rh*.3&&l.bbox.y0<(p.y1||0)+rh*3&&Math.abs(l.bbox.x0-(p.x0||0))<rh*3);
 const above=lines.filter(l=>l!==line&&l.bbox&&l.bbox.y1<=(p.y0||0)+rh*.5&&l.bbox.y1>(p.y0||0)-rh*5&&l.bbox.x0>=(p.x0||0)-rh&&l.bbox.x0<(p.x0||0)+rh*10);
 const read=(nearby,pattern)=>[line,...nearby].map(l=>({match:l.text.match(pattern),box:l.bbox})).find(r=>r.match);
 const lv=read(below,/(?:L[vV]\.?|레벨)\s*([1-6])(?!\d)/i);
 const count=read(above,/[x×✕]\s*(\d{1,4})(?!\d)/i);
 const group=b.id+'_'+Math.round(p.x0||0)+'_'+Math.round(p.y0||0);
 for(const [field,m]of [['lv',lv],['count',count]])out.push(entry(group+'_'+field,b.name+(field==='lv'?' 레벨':' 수량'),m?Number(m.match[1]):null,{kind:'building',building:b.id,field,group,anchor:p,box:m?.box,needsReview:true}));
 }return out;
}
function mergeFindings(additions){for(const f of additions){const prior=findings.find(p=>p.source===f.source&&(f.kind==='stock'?p.kind==='stock'&&p.target===f.target:p.building===f.building&&p.field===f.field&&Math.abs((p.anchor?.y0||0)-(f.anchor?.y0||0))<25&&Math.abs((p.anchor?.x0||0)-(f.anchor?.x0||0))<25));if(!prior){findings.push(f);continue;}if(f.value===null||f.value===undefined)continue;if(prior.value===null||prior.value===undefined){prior.value=f.value;prior.needsReview=!!f.needsReview;prior.preview=f.preview||prior.preview;}else if(prior.value!==f.value){prior.needsReview=true;prior.candidates=[...new Set([prior.value,f.value,...(prior.candidates||[])])];}}}
// Overlapping scrolling screenshots show the same card at different positions.
// Preserve its count once by matching a building and its displayed level.
function dedupePhotoPages(){
 const grouped=new Map(),seen=new Map(),removed=new Set();
 for(const f of findings){if(f.kind!=='building'||!f.group)continue;if(!grouped.has(f.group))grouped.set(f.group,{building:f.building,source:f.source});grouped.get(f.group)[f.field]=f;}
 for(const [group,card] of grouped){const lv=card.lv?.value;
  if(!Number.isInteger(lv)||lv<1||lv>6)continue;
  const key=card.building+'_'+lv,previous=seen.get(key);
  if(!previous){seen.set(key,{group,card});continue;}
  if(previous.card.source===card.source)continue;
  if(previous.card.count&&card.count){
   const old=previous.card.count,other=card.count;
   const options=[...new Set([...(old.candidates||[]),...(other.candidates||[]),old.value,other.value].filter(n=>n!==null&&n!==undefined))];
   if(options.length>1){old.value=null;old.needsReview=true;old.candidates=options;}
   else if(options.length===1){
    if(old.value===null)old.preview=other.preview||old.preview;
    old.value=options[0];old.needsReview=true;
   }
  }
  if(previous.card.lv&&card.lv&&(previous.card.lv.needsReview||card.lv.needsReview)){
   previous.card.lv.needsReview=true;previous.card.lv.candidates=[...new Set([...(previous.card.lv.candidates||[]),...(card.lv.candidates||[]),lv])];
  }
  removed.add(group);
 }
 if(removed.size)findings=findings.filter(f=>!removed.has(f.group));
}
// Resolve the displayed level from the current group, including OCR recovery,
// candidate selection and manual edits; never keep the first visual guess.
function reviewLabel(f){if(f.kind!=='building')return f.label;const b=BUILDINGS.find(b=>b.id===f.building);if(!b)return f.label;const lv=findings.find(g=>g.group===f.group&&g.field==='lv')?.value;return b.name+(Number.isInteger(lv)&&lv>=1&&lv<=6?' (Lv.'+lv+')':'')+(f.field==='lv'?' 레벨':' 수량');}
function syncReviewLabels(group){for(const [i,f]of findings.entries()){if(!group||f.group!==group)continue;const label=reviewLabel(f),node=document.querySelector('[data-photo-label="'+i+'"]');if(node)node.textContent=label;for(const [selector,suffix]of [['[data-photo-value="'+i+'"]',' 인식값'],['[data-photo-check="'+i+'"]',' 적용']])document.querySelector(selector)?.setAttribute('aria-label',label+suffix);}}
function render(){el('photoReview').innerHTML=findings.length?'<button type="button" id="photoSkipUncertain">확인 필요 항목 선택 해제</button><table class="photo-table"><thead><tr><th>적용</th><th>항목</th><th>인식값 · 수정 가능</th></tr></thead><tbody>'+findings.map((f,i)=>'<tr><td><input type="checkbox" data-photo-check="'+i+'" '+(f.value!==null&&!f.needsReview&&!findings.some(g=>g.group&&g.group===f.group&&(g.value===null||g.needsReview))?'checked ':'')+'aria-label="'+safeText(reviewLabel(f))+' 적용"></td><td><span data-photo-label="'+i+'">'+safeText(reviewLabel(f))+'</span>'+(f.needsReview?'<small class="photo-caution">'+(f.value===null&&!f.candidates?.length?'인식값 없음 · 직접 입력':'추가 확인 필요')+'</small>':'')+'</td><td><input type="text" inputmode="decimal" placeholder="직접 입력" data-photo-value="'+i+'" value="'+(f.value??'')+'" aria-label="'+safeText(reviewLabel(f))+' 인식값">'+(f.candidates?.length&&(f.needsReview||f.candidates.length>1)?'<div class="photo-candidates">'+f.candidates.map(n=>'<button type="button" data-photo-pick="'+i+'" data-photo-number="'+n+'" aria-pressed="'+(f.value===n)+'">'+n+'</button>').join('')+'</div>':'')+(f.preview?'<img class="photo-preview" src="'+f.preview+'" alt="'+safeText(reviewLabel(f))+' 원본 숫자 확대">':'')+'</td></tr>').join('')+'</tbody></table><p class="photo-description">인식값을 수정한 뒤 적용할 항목을 체크하세요. 건물은 레벨과 수량을 함께 선택하세요. 기존 상세 설정의 다른 레벨은 유지됩니다.</p>':'';el('photoApply').disabled=!findings.length;}
// Coordinates describe the wide Korean game layout at a reference height of 709px.
function photoCrop(canvas,[x,y,w,h],threshold,light){
 const scale=canvas.height/709,cv=document.createElement('canvas');
 cv.width=w*4+32;cv.height=h*4+32;
 const ctx=cv.getContext('2d',{willReadFrequently:true});
 ctx.fillStyle='white';ctx.fillRect(0,0,cv.width,cv.height);
 ctx.drawImage(canvas,x*scale,y*scale,w*scale,h*scale,16,16,w*4,h*4);
 if(threshold===null)return cv;
 const pixels=ctx.getImageData(16,16,w*4,h*4);
 for(let i=0;i<pixels.data.length;i+=4){
  const d=pixels.data,gray=.299*d[i]+.587*d[i+1]+.114*d[i+2];
  const ink=light?gray>threshold:gray<threshold;
  d[i]=d[i+1]=d[i+2]=ink?0:255;
 }
 ctx.putImageData(pixels,16,16);
 return cv;
}
function photoPixels(canvas,x,y,w,h){
 const scale=canvas.height/709;
 return canvas.getContext('2d').getImageData(Math.round(x*scale),Math.round(y*scale),Math.ceil(w*scale),Math.ceil(h*scale)).data;
}
function colorRatio(data,match){
 let hits=0;
 for(let i=0;i<data.length;i+=4)if(match(data[i],data[i+1],data[i+2]))hits++;
 return hits*4/data.length;
}
async function readGameLayout(worker,canvas,kind){
 const referenceWidth=canvas.width*709/canvas.height;
 if(referenceWidth<1380||referenceWidth>1700)return [];
 const read=async (box,threshold,light)=>{
  const crop=photoCrop(canvas,box,threshold,light);
  const {data}=await worker.recognize(crop);
  return {data,preview:()=>photoCrop(canvas,box,null,false).toDataURL('image/png')};
 };
 const rows=[];
 try{
  if(kind==='stocks'){
   const shift=(referenceWidth-1536)/2;
   const centered=([x,...box])=>[x+shift,...box];
   const paper=photoPixels(canvas,...centered([750,340,40,24]));
   if(colorRatio(paper,(r,g,b)=>r>215&&g>195&&r>g&&g>b+20)<.9)return [];
   await worker.setParameters({tessedit_pageseg_mode:'7'});
   const title=await read(centered([303,121,90,26]),155,true);
   if(!clean(title.data.text).includes('마야'))return [];
   // The header shows cocoa, jade and obsidian. Feathers are not in this panel.
   const positions=[
    ['옥',[554,15,61,26],105,true],
    ['흑요석',[662,15,64,26],105,true],
    ['마스크',[374,184,68,28],128,false],
    ['달력돌',[687,184,70,28],128,false],
    ['단검',[998,184,83,28],128,false],
    ['머리장식',[374,266,62,28],128,false]
   ];
   await worker.setParameters({tessedit_char_whitelist:'0123456789.,KkMm'});
   for(const [target,box,threshold,light] of positions){
    const {data,preview}=await read(centered(box),threshold,light);
    const value=stockNumber(data.text);
    if(value!==null)rows.push(entry('stock_'+target,target+' 보유량',value,{kind:'stock',target,preview:preview()}));
   }
  }else{
   // Verify the move/storage panel before using its two-column card layout.
   await worker.setParameters({tessedit_pageseg_mode:'7'});
   const footer=await read([111,647,211,30],155,true);
   if(!clean(footer.data.text).includes('보관'))return [];
   for(const y of [97,228,360,491])for(const x of [91,223]){
    await worker.setParameters({tessedit_char_whitelist:''});
    const nameBox=[x,y,127,26];
    const name=await read(nameBox,155,true);
    let building=matchBuilding(name.data.text);
    if(!building){
     // Some game backgrounds break up the pale strokes at the first threshold.
     const retry=await read(nameBox,180,true);
     building=matchBuilding(retry.data.text);
    }
    if(!building)continue;
    await worker.setParameters({tessedit_char_whitelist:'0123456789'});
    const levelBox=[x+32,y+29,22,25];
    const level=await read(levelBox,155,true);
    let lvMatch=level.data.text.trim().match(/^[1-6]$/);
    if(!lvMatch){
     await worker.setParameters({tessedit_pageseg_mode:'10'});
     lvMatch=(await read(levelBox,135,true)).data.text.trim().match(/^[1-6]$/);
     await worker.setParameters({tessedit_pageseg_mode:'7'});
    }
    const lv=lvMatch?Number(lvMatch[0]):null;
    const badge=[x+94,y-37,37,37];
    const orange=colorRatio(photoPixels(canvas,...badge),(r,g,b)=>r>175&&g>98&&g<227&&b<140&&r>g+30&&g>b+20);
    let count=null,preview;
    if(orange>.25){
     await worker.setParameters({tessedit_char_whitelist:'0123456789xX'});
     const result=await read([x+99,y-29,29,24],110,false);
     const match=result.data.text.trim().match(/^[xX]?\s*(\d{1,4})$/);
     if(match&&Number(match[1])>0)count=Number(match[1]);
     preview=result.preview();
    }else if(orange<.06){
     count=1;
     preview=photoCrop(canvas,badge,null,false).toDataURL('image/png');
    }
    const scale=canvas.height/709,anchor={x0:x*scale,y0:y*scale};
    const group=building.id+'_'+x+'_'+y;
    for(const [field,value,image] of [['lv',lv,level.preview()],['count',count,preview]]){
     rows.push(entry(group+'_'+field,building.name+(field==='lv'?' 레벨':' 수량'),value,{kind:'building',building:building.id,field,group,anchor,preview:image}));
    }
   }
  }
  return rows;
 }catch(e){
  // A fixed-coordinate crop must never prevent full-image OCR on a changed layout.
  return [];
 }finally{
  await worker.setParameters({tessedit_pageseg_mode:'11',tessedit_char_whitelist:''});
 }
}
async function scan(){
 if(busy)return;const buildingFiles=Array.from(el('photoBuildings').files||[]),stockFiles=Array.from(el('photoStocks').files||[]);
 if(buildingFiles.length>2){status('건물 목록 사진은 최대 2장까지 선택할 수 있습니다.',true);return;}
 const files=[...buildingFiles.map((f,i)=>['buildings',f,'buildings_'+i]),...stockFiles.slice(0,1).map(f=>['stocks',f,'stocks'])];
 if(!files.length){status('사진을 선택해주세요.',true);return;}
 const failed=[];
 busy=true;el('photoScan').disabled=true;el('photoApply').disabled=true;findings=[];render();syncClear();
 try{status('문자 인식 엔진을 준비하고 있습니다. 처음에는 시간이 걸릴 수 있습니다…');const w=await engine();await w.setParameters({tessedit_pageseg_mode:'11'});
 for(const [kind,file,source]of files){try{if(!file.type.startsWith('image/')||file.size>20*1024*1024)throw new Error('20MB 이하 이미지 파일을 선택하세요.');
 status('사진 '+(files.findIndex(f=>f[2]===source)+1)+' / '+files.length+' · 건물명과 숫자를 확인하고 있습니다…');
 const url=URL.createObjectURL(file);try{const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('사진을 열 수 없습니다.'));image.src=url;});
 const scale=Math.min(2,1600/image.naturalHeight,3000/image.naturalWidth),canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,canvas.width,canvas.height);
 const localRows=await readGameLayout(w,canvas,kind);
 for(const f of localRows){
  f.source=source;f.needsReview=true;
  if(f.group)f.group=source+'_'+f.group;
 }
 mergeFindings(localRows);
 if(kind==='stocks'?localRows.length===6:localRows.length&&localRows.every(f=>f.value!==null))continue;
 const collect=async input=>{
  const {data}=await w.recognize(input);
  const lines=recognizedLines(data);
  const rows=kind==='buildings'?parseBuildingLines(lines):parseStockLines(lines).filter(
   row=>!localRows.some(local=>local.target===row.target)
  );
  for(const f of rows){
   f.source=source;f.needsReview=true;
   if(f.group)f.group=source+'_'+f.group;
   if(f.box){
    const {x0,y0,x1,y1}=f.box;
    const preview=document.createElement('canvas');
    preview.width=Math.max(1,x1-x0);preview.height=Math.max(1,y1-y0);
    preview.getContext('2d').drawImage(canvas,x0,y0,preview.width,preview.height,0,0,preview.width,preview.height);
    f.preview=preview.toDataURL('image/png');
   }
  }
  mergeFindings(rows);
 };
 await collect(canvas);
 status('대비를 높여 이름과 숫자를 다시 확인하고 있습니다…');
 await collect(contrastImage(canvas));
 }finally{URL.revokeObjectURL(url);}
 }catch(e){failed.push((kind==='stocks'?'보유량 사진':'건물 사진 '+(Number(source.split('_')[1])+1))+' · '+e.message);}}
 dedupePhotoPages();const recognized=findings.filter(f=>f.value!==null||f.candidates?.length).length;addMissing(files);render();const result=recognized?'인식값 '+recognized+'개 · 원본과 비교해 적용할 항목을 선택하세요.':'이름과 숫자를 읽지 못했습니다. 글자가 선명한 게임 화면으로 다시 분석하거나 직접 입력해 주세요.';
 status([result,...failed].join(' / '),!recognized||failed.length>0);
 }catch(e){addMissing(files);render();status(e.message+' · 아래에서 직접 입력할 수도 있습니다.',true);}
 finally{busy=false;el('photoScan').disabled=false;syncClear();}
}
function addMissing(files){
 if(files.some(f=>f[0]==='stocks'))for(const s of STOCKS)if(!findings.some(f=>f.kind==='stock'&&f.target===s.target))findings.push(entry('stock_'+s.target,s.name+' 보유량',null,{kind:'stock',target:s.target,needsReview:true}));
 if(files.some(f=>f[0]==='buildings'))for(const b of BUILDINGS)if(!findings.some(f=>f.kind==='building'&&f.building===b.id))for(const field of ['lv','count'])findings.push(entry(b.id+'_'+field,b.name+(field==='lv'?' 레벨':' 수량'),null,{kind:'building',building:b.id,field,group:'manual_'+b.id,needsReview:true}));
}
function apply(){
 if(busy)return;
 const selected=[];
 for(const box of el('photoReview').querySelectorAll('[data-photo-check]:checked')){
  const f=findings[Number(box.dataset.photoCheck)];
  const input=el('photoReview').querySelector('[data-photo-value="'+box.dataset.photoCheck+'"]');
  const n=quantity(input.value);
  if(n===null||(f.kind==='building'&&n<0)||(f.field==='lv'&&(n<1||n>6))||(f.field==='count'&&n>100000)){
   status(reviewLabel(f)+' 값을 확인하세요.',true);return;
  }
  selected.push({...f,value:n});
 }
 if(!selected.length){status('적용할 항목을 체크해주세요.',true);return;}
 const groups=new Map(),stocks=new Set();
 for(const f of selected){
  if(f.kind==='stock'){
   if(stocks.has(f.target)){status('같은 보유량은 하나만 선택하세요.',true);return;}
   stocks.add(f.target);continue;
  }
  if(!groups.has(f.group))groups.set(f.group,{building:f.building});
  const g=groups.get(f.group);
  if(g[f.field]!==undefined){status('같은 건물 값은 중복 적용할 수 없습니다.',true);return;}
  g[f.field]=f.value;
 }
 for(const g of groups.values())if(g.lv===undefined||g.count===undefined){
  status('건물은 레벨과 수량을 함께 선택해주세요.',true);return;
 }
 for(const g of groups.values()){
  if(findings.some(f=>f.kind==='building'&&f.building===g.building&&!groups.has(f.group))){
   status('이 건물의 다른 레벨도 함께 선택해야 합니다.',true);return;
  }
 }
 const byBuilding=new Map();
 for(const g of groups.values()){
  if(!byBuilding.has(g.building))byBuilding.set(g.building,[]);
  byBuilding.get(g.building).push(g);
 }
 for(const [id,rows] of byBuilding){
  const levels=new Set(rows.map(r=>r.lv));
  if(levels.size!==rows.length){status(id+'의 같은 레벨을 중복 인식했습니다. 수량을 확인해주세요.',true);return;}
 }
 // Apply only after every selected group has been validated.
 for(const f of selected.filter(f=>f.kind==='stock')){
  const stock=STOCKS.find(x=>x.target===f.target);
  if(stock)state[stock.group][stock.target].stock=f.value;
 }
 for(const [id,rows] of byBuilding){
  const b=BUILDINGS.find(b=>b.id===id),old=state[b.group][b.production];
  const details=b.group==='resources'?resourceDetails:productDetails;
  const previous=details[b.production],active=previous?.enabled?previous.rows.map(r=>({...r})):[];
  const imported=new Map(rows.map(r=>[r.lv,r.count]));
  const updated=active.map(r=>imported.has(Number(r.lv))?{...r,count:0}:r);
  for(const {lv,count} of rows){
   const existing=updated.find(r=>Number(r.lv)===lv);
   if(existing){existing.count=count;continue;}
   if(b.group==='products')
    updated.push({lv,count,mode:supportedMode(b.production,lv,old.mode)||referenceRecipe(b.production,lv,'최장')?.mode||'30분',hours:'',happiness:old.happiness});
   else updated.push({lv,count,hours:'',happiness:old.happiness});
  }
  const keepDetails=!!previous?.enabled||updated.length>1;
  details[b.production]={enabled:keepDetails,rows:keepDetails?updated:[]};
  old.lv=rows[0].lv;
  old.bldgs=keepDetails?updated.reduce((sum,r)=>sum+Number(r.count||0),0):rows.reduce((sum,r)=>sum+r.count,0);
  if(b.group==='products')old.mode=supportedMode(b.production,old.lv,old.mode)||referenceRecipe(b.production,old.lv,'최장')?.mode||'30분';
 }
 normalizeState();
 syncUIFromState();
 renderAll();
 saveState();
 status('선택한 값 '+selected.length+'개를 적용했습니다.');
 el('resetStatus').textContent='사진 입력 완료 · 선택한 항목만 반영했습니다.';
 el('photoImportDialog').close();
}
function reset(){if(busy)return;for(const id of ['photoBuildings','photoStocks'])el(id).value='';findings=[];render();syncClear();status('한 종류의 사진만 올려도 됩니다.');}
function syncClear(){for(const id of ['photoBuildings','photoStocks'])el(id).disabled=busy;el('photoBuildingsClear').disabled=busy||!el('photoBuildings').files.length;el('photoStocksClear').disabled=busy||!el('photoStocks').files.length;el('photoReset').disabled=busy||!el('photoBuildings').files.length&&!el('photoStocks').files.length&&!findings.length;}
el('photoReview').onclick=e=>{if(e.target.id==='photoSkipUncertain'){const uncertain=new Set(findings.filter(f=>f.value===null||f.needsReview).map(f=>f.group).filter(Boolean));for(const box of document.querySelectorAll('[data-photo-check]')){const f=findings[Number(box.dataset.photoCheck)];if(f.value===null||f.needsReview||uncertain.has(f.group))box.checked=false;}status('확인이 필요한 항목의 선택을 해제했습니다.');return;}const button=e.target.closest('[data-photo-pick]');if(!button)return;const i=Number(button.dataset.photoPick),n=Number(button.dataset.photoNumber);findings[i].value=n;const input=document.querySelector('[data-photo-value="'+i+'"]');input.value=n;document.querySelector('[data-photo-check="'+i+'"]').checked=true;syncReviewLabels(findings[i].group);for(const b of el('photoReview').querySelectorAll('[data-photo-pick="'+i+'"]'))b.setAttribute('aria-pressed',String(Number(b.dataset.photoNumber)===n));};
el('photoReview').oninput=e=>{const i=e.target.dataset.photoValue;if(i!==undefined){findings[Number(i)].value=quantity(e.target.value);document.querySelector('[data-photo-check="'+i+'"]').checked=e.target.value.trim()!=='';syncReviewLabels(findings[Number(i)].group);}};
el('photoImportBtn').onclick=()=>el('photoImportDialog').showModal();el('photoImportClose').onclick=()=>el('photoImportDialog').close();el('photoScan').onclick=scan;el('photoApply').onclick=apply;el('photoReset').onclick=reset;for(const [input,button]of [['photoBuildings','photoBuildingsClear'],['photoStocks','photoStocksClear']]){el(input).onchange=()=>{findings=[];render();syncClear();};el(button).onclick=()=>{if(busy)return;el(input).value='';findings=[];render();syncClear();};}
})();

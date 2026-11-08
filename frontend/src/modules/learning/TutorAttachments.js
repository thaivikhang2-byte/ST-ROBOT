// Images stay in memory until the learner explicitly submits the tutor form.
export const ATTACHMENT_LIMITS = Object.freeze({count:2, sourceBytes:8*1024*1024, bytes:1572864, totalBytes:3145728, edge:1600, pixels:25000000});
export function createTutorAttachments({form,input,fileInput,pasteButton,captureButton,previewHost,statusHost,panel,launcher,onChange=()=>{}}){
 const doc=form.ownerDocument,win=doc.defaultView;
 let items=[],generation=0,pending=false,disabled=false,destroyed=false,stream=null,video=null,captureRestore=null;
 const listeners=[];
 const listen=(target,event,handler)=>{target?.addEventListener(event,handler);listeners.push(()=>target?.removeEventListener(event,handler))};
 const say=text=>{statusHost.textContent=text};
 const stop=()=>{try{stream?.getTracks().forEach(track=>track.stop())}finally{stream=null;if(video){video.pause();video.srcObject=null;video.remove();video=null}captureRestore?.();captureRestore=null}};
 const notify=()=>{fileInput.disabled=disabled||pending;pasteButton.disabled=disabled||pending;captureButton.disabled=disabled||pending;onChange({busy:pending,count:items.length})};
 const render=()=>{previewHost.replaceChildren(...items.map((item,index)=>{
  const card=doc.createElement('figure'),img=doc.createElement('img'),remove=doc.createElement('button'),caption=doc.createElement('figcaption');
  img.src=item.dataUrl;img.alt='Ảnh lỗi đính kèm '+(index+1);img.width=100;img.height=72;
  caption.textContent='Ảnh '+(index+1)+' · '+item.width+' × '+item.height;
  remove.type='button';remove.textContent='Bỏ ảnh '+(index+1);remove.disabled=disabled;
  remove.onclick=()=>{items=items.filter(value=>value!==item);render();notify();say(items.length?'Ảnh đang chờ gửi cùng câu hỏi.':'Đã bỏ ảnh đính kèm.')};
  card.append(img,caption,remove);return card;
 }));notify()};
 const current=ticket=>!destroyed&&ticket===generation;
 const canvasBlob=(canvas,quality)=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Hãy thử ảnh khác hoặc chụp lại vùng lỗi.')),'image/jpeg',quality));
 const blobData=blob=>new Promise((resolve,reject)=>{const reader=new win.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Đọc ảnh chưa thành công. Hãy thử lại.'));reader.readAsDataURL(blob)});
 const normalize=async blob=>{
  if(!blob||!['image/png','image/jpeg','image/webp'].includes(blob.type))throw Error('Chọn ảnh PNG, JPG hoặc WebP.');
  if(blob.size>ATTACHMENT_LIMITS.sourceBytes)throw Error('Ảnh gốc tối đa 8 MB. Hãy chụp gọn vùng lỗi rồi thử lại.');
  let bitmap;
  try{bitmap=await win.createImageBitmap(blob)}catch{throw Error('Tệp này chưa đọc được như ảnh. Hãy chọn ảnh PNG, JPG hoặc WebP khác.')}
  try{
   if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>ATTACHMENT_LIMITS.pixels)throw Error('Ảnh quá lớn. Hãy chụp riêng vùng mã và thông báo lỗi.');
   const scale=Math.min(1,ATTACHMENT_LIMITS.edge/Math.max(bitmap.width,bitmap.height)),canvas=doc.createElement('canvas');
   canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
   let result=await canvasBlob(canvas,.9);
   if(result.size>ATTACHMENT_LIMITS.bytes)result=await canvasBlob(canvas,.7);
   if(result.size>ATTACHMENT_LIMITS.bytes)throw Error('Ảnh sau xử lý vẫn quá lớn. Hãy chụp gọn vùng lỗi.');
   return {dataUrl:await blobData(result),bytes:result.size,width:canvas.width,height:canvas.height};
  }finally{bitmap.close()}
 };
 const append=async(files,ticket)=>{
  if(!current(ticket))return;
  if(files.length+items.length>ATTACHMENT_LIMITS.count)throw Error('Mỗi câu hỏi gửi tối đa 2 ảnh. Bỏ một ảnh trước khi thêm.');
  const additions=[];
  for(const file of files){const item=await normalize(file);if(!current(ticket))return;additions.push(item)}
  if(items.concat(additions).reduce((total,item)=>total+item.bytes,0)>ATTACHMENT_LIMITS.totalBytes)throw Error('Tổng ảnh tối đa 3 MB. Hãy chọn ảnh nhỏ hơn.');
  if(current(ticket)){items.push(...additions);render();say('Đã chuẩn bị '+items.length+' ảnh. Xem lại rồi bấm Gửi để AI phân tích.')}
 };
 const perform=async operation=>{
  if(disabled||pending||destroyed)return;
  pending=true;const ticket=++generation;notify();say('Đang chuẩn bị ảnh…');
  try{await operation(ticket)}catch(error){if(current(ticket))say(error.name==='NotAllowedError'||error.name==='AbortError'?'Đã dừng chụp hoặc chưa cấp quyền. Bạn có thể chọn Thêm ảnh hoặc thử lại.':error.message||'Hãy thử thêm ảnh lại.')}
  finally{if(current(ticket)){stop();pending=false;render()}}
 };
 const choose=()=>{const files=[...fileInput.files];fileInput.value='';if(files.length)perform(ticket=>append(files,ticket))};
 const paste=event=>{
  const files=[...(event.clipboardData?.items||[])].filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);
  if(!files.length)return;event.preventDefault();perform(ticket=>append(files,ticket));
 };
 listen(fileInput,'change',choose);listen(form,'paste',paste);
 listen(pasteButton,'click',()=>{
  if(!win.navigator.clipboard?.read){input.focus();say('Bấm vào ô câu hỏi rồi dán ảnh bằng Ctrl+V hoặc chọn Thêm ảnh.');return}
  perform(async ticket=>{let clipboard;try{clipboard=await win.navigator.clipboard.read()}catch{say('Bấm vào ô câu hỏi và dán ảnh, hoặc chọn Thêm ảnh.');input.focus();return}
   const files=[];for(const entry of clipboard){const type=entry.types.find(type=>['image/png','image/jpeg','image/webp'].includes(type));if(type)files.push(await entry.getType(type))}
   if(!files.length)throw Error('Bộ nhớ sao chép chưa có ảnh. Hãy sao chép ảnh hoặc chọn Thêm ảnh.');await append(files,ticket);
  });
 });
 listen(captureButton,'click',()=>{
  if(items.length>=ATTACHMENT_LIMITS.count){say('Mỗi câu hỏi gửi tối đa 2 ảnh. Bỏ một ảnh trước khi chụp.');return}
  if(!win.isSecureContext||!win.navigator.mediaDevices?.getDisplayMedia){say('Trình duyệt này dùng Thêm ảnh hoặc dán ảnh. Chụp trực tiếp khả dụng trên trình duyệt máy tính hỗ trợ chia sẻ màn hình.');return}
  perform(async ticket=>{
   // Invoked before the first await to preserve the browser's user activation.
   const request=win.navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser'},audio:false});
   const selected=await request;if(!current(ticket)){selected.getTracks().forEach(track=>track.stop());return}stream=selected;
   video=doc.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=stream;
   video.style.cssText='position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px';doc.body.append(video);
   let readyTimer;try{await Promise.race([video.play(),new Promise((_,reject)=>{readyTimer=win.setTimeout(()=>reject(Error('Chưa nhận được hình ảnh. Hãy chọn lại tab hoặc dùng Thêm ảnh.')),8000)})])}finally{win.clearTimeout(readyTimer)}if(!current(ticket))return;
   const saved=[panel,launcher].filter(Boolean).map(element=>({element,visibility:element.style.visibility}));
   saved.forEach(({element})=>element.style.visibility='hidden');captureRestore=()=>saved.forEach(({element,visibility})=>element.style.visibility=visibility);
   await new Promise(resolve=>win.setTimeout(resolve,150));if(!current(ticket))return;
   const width=video.videoWidth,height=video.videoHeight;
   if(!width||!height)throw Error('Chưa nhận được khung hình. Hãy chọn lại tab hoặc cửa sổ.');
   const scale=Math.min(1,ATTACHMENT_LIMITS.edge/Math.max(width,height)),canvas=doc.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
   const blob=await canvasBlob(canvas,.9);if(!current(ticket))return;stop();await append([blob],ticket);
  });
 });
 const cancelPending=()=>{generation++;pending=false;stop();notify()};
 const clear=()=>{cancelPending();items=[];render();say('')};
 // Closing the widget stops a live capture but keeps any already prepared image.
 const observer=panel?new win.MutationObserver(()=>{if(panel.hidden&&pending){cancelPending();say('Đã dừng chuẩn bị ảnh. Ảnh đã thêm vẫn ở đây.')}}):null;
 observer?.observe(panel,{attributes:true,attributeFilter:['hidden']});
 listen(win,'pagehide',cancelPending);
 render();
 return {getImages:()=>items.map(({dataUrl})=>({dataUrl})),clear,cancelPending,get busy(){return pending},setDisabled(value){disabled=Boolean(value);render()},destroy(){destroyed=true;clear();observer?.disconnect();listeners.forEach(remove=>remove())}};
}

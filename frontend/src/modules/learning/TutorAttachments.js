import { createImageCropper, decodeImageBlob } from './ImageCropper.js?v=screen-region-v2';

// Drafts and source pixels stay in memory; only prepared images leave on Send.
export const ATTACHMENT_LIMITS = Object.freeze({count:2, sourceBytes:8*1024*1024, bytes:1572864, totalBytes:3145728, edge:1600, pixels:25000000});
export function createTutorAttachments({form,input,fileInput,captureInput,pasteButton,captureButton,previewHost,statusHost,panel,launcher,onChange=()=>{}}){
 const doc=form.ownerDocument,win=doc.defaultView;
 const cropper=createImageCropper({document:doc});
 const captureFile=captureInput||doc.createElement('input');
 if(!captureInput){captureFile.type='file';captureFile.accept='image/png,image/jpeg,image/webp';captureFile.hidden=true;form.append(captureFile)}
 let items=[],generation=0,pending=false,disabled=false,destroyed=false,stream=null,video=null,captureRestore=null,operationController=null,pickerTicket=0;
 let preferFileCapture=!win.isSecureContext||!win.navigator.mediaDevices?.getDisplayMedia;
 const listeners=[];
 const listen=(target,event,handler)=>{target?.addEventListener(event,handler);listeners.push(()=>target?.removeEventListener(event,handler))};
 const say=text=>{statusHost.textContent=text};
 const stop=()=>{try{stream?.getTracks().forEach(track=>track.stop())}finally{stream=null;if(video){video.pause();video.srcObject=null;video.remove();video=null}captureRestore?.();captureRestore=null}};
 const current=ticket=>!destroyed&&ticket===generation;
 const notify=()=>{
  fileInput.disabled=disabled||pending;captureFile.disabled=disabled||pending;
  pasteButton.disabled=disabled||pending;captureButton.disabled=disabled||pending;
  onChange({busy:pending,count:items.length});
 };
 const canvasBlob=(canvas,quality)=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Hãy thử ảnh khác hoặc chụp lại vùng lỗi.')),'image/jpeg',quality));
 const blobData=blob=>new Promise((resolve,reject)=>{const reader=new win.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Đọc ảnh chưa thành công. Hãy thử lại.'));reader.readAsDataURL(blob)});
 const dataBlob=data=>{const [header,encoded]=data.split(',');return new win.Blob([Uint8Array.from(win.atob(encoded),c=>c.charCodeAt(0))],{type:header.includes('image/png')?'image/png':'image/jpeg'})};
 const normalize=async(blob,{generated=false}={})=>{
  if(!blob||!['image/png','image/jpeg','image/webp'].includes(blob.type))throw Error('Chọn ảnh PNG, JPG hoặc WebP.');
  if(!generated&&blob.size>ATTACHMENT_LIMITS.sourceBytes)throw Error('Ảnh gốc tối đa 8 MB. Hãy chụp gọn vùng lỗi rồi thử lại.');
  let decoded;
  try{decoded=await decodeImageBlob(blob,{document:doc})}catch{throw Error('Tệp này chưa đọc được như ảnh. Hãy chọn ảnh PNG, JPG hoặc WebP khác.')}
  try{
   if(!decoded.width||!decoded.height||decoded.width*decoded.height>ATTACHMENT_LIMITS.pixels)throw Error('Ảnh quá lớn. Hãy chụp riêng vùng mã và thông báo lỗi.');
   const scale=Math.min(1,ATTACHMENT_LIMITS.edge/Math.max(decoded.width,decoded.height)),canvas=doc.createElement('canvas');
   canvas.width=Math.max(1,Math.round(decoded.width*scale));canvas.height=Math.max(1,Math.round(decoded.height*scale));
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(decoded.image,0,0,canvas.width,canvas.height);
   let result=await canvasBlob(canvas,.9);
   if(result.size>ATTACHMENT_LIMITS.bytes)result=await canvasBlob(canvas,.7);
   if(result.size>ATTACHMENT_LIMITS.bytes)throw Error('Ảnh sau xử lý vẫn quá lớn. Hãy chụp gọn vùng lỗi.');
   return {dataUrl:await blobData(result),bytes:result.size,width:canvas.width,height:canvas.height,sourceBlob:blob.size<=ATTACHMENT_LIMITS.sourceBytes?blob:result};
  }finally{decoded.close()}
 };
 const fits=next=>next.reduce((total,item)=>total+item.bytes,0)<=ATTACHMENT_LIMITS.totalBytes;
 const render=()=>{
  previewHost.replaceChildren(...items.map((item,index)=>{
   const card=doc.createElement('figure'),img=doc.createElement('img'),remove=doc.createElement('button'),edit=doc.createElement('button'),controls=doc.createElement('div'),caption=doc.createElement('figcaption');
   img.src=item.dataUrl;img.alt='Ảnh lỗi đính kèm '+(index+1);img.width=100;img.height=72;
   caption.textContent='Ảnh '+(index+1)+' · '+item.width+' × '+item.height;
   controls.className='tutor-image-controls';
   remove.type='button';remove.textContent='Bỏ ảnh '+(index+1);remove.disabled=disabled||pending;
   remove.onclick=()=>{if(disabled||pending)return;items=items.filter(value=>value!==item);render();say(items.length?'Ảnh đang chờ gửi cùng câu hỏi.':'Đã bỏ ảnh đính kèm.')};
   edit.type='button';edit.textContent='Cắt ảnh '+(index+1);edit.dataset.action='crop-image';edit.disabled=disabled||pending;
   edit.onclick=()=>perform(async(ticket,signal)=>{
    const cropped=await cropper.edit(item.sourceBlob||dataBlob(item.dataUrl),{signal});
    if(!current(ticket))return;
    if(!cropped){say('Đã hủy cắt. Ảnh trước đó được giữ nguyên.');return}
    const replacement=await normalize(cropped,{generated:true});if(!current(ticket))return;
    const next=items.map(value=>value===item?replacement:value);
    if(!fits(next))throw Error('Tổng ảnh tối đa 3 MB. Hãy chọn ảnh nhỏ hơn.');
    items=next;render();say('Đã cắt ảnh. Xem lại rồi bấm Gửi để AI phân tích.');
   });
   controls.append(edit,remove);card.append(img,caption,controls);return card;
  }));notify();
 };
 const append=async(files,ticket,{generated=false}={})=>{
  if(!current(ticket))return;
  if(files.length+items.length>ATTACHMENT_LIMITS.count)throw Error('Mỗi câu hỏi gửi tối đa 2 ảnh. Bỏ một ảnh trước khi thêm.');
  const additions=[];
  for(const file of files){const item=await normalize(file,{generated});if(!current(ticket))return;additions.push(item)}
  if(!fits(items.concat(additions)))throw Error('Tổng ảnh tối đa 3 MB. Hãy chọn ảnh nhỏ hơn.');
  if(current(ticket)){items.push(...additions);render();say('Đã chuẩn bị '+items.length+' ảnh. Xem lại rồi bấm Gửi để AI phân tích.')}
 };
 const perform=async operation=>{
  if(disabled||pending||destroyed)return;
  pending=true;const ticket=++generation;const controller=new win.AbortController();operationController=controller;
  render();say('Đang chuẩn bị ảnh…');
  try{await operation(ticket,controller.signal)}catch(error){
   if(current(ticket)){
    if(error.name==='NotSupportedError'){preferFileCapture=true;captureButton.textContent='Chọn ảnh chụp';say('Trình duyệt chưa hỗ trợ chụp trực tiếp. Bấm Chọn ảnh chụp để chọn ảnh màn hình trên máy rồi cắt vùng cần hỏi.')}
    else say(error.name==='NotAllowedError'||error.name==='AbortError'?'Đã dừng chụp hoặc chưa cấp quyền. Bạn có thể chọn Thêm ảnh hoặc thử lại.':error.message||'Hãy thử thêm ảnh lại.');
   }
  }finally{if(current(ticket)){stop();operationController=null;pending=false;render()}}
 };
 const editCapture=async(blob,ticket,signal)=>{
  if(!current(ticket))return;
  say('Kéo chọn vùng cần hỏi, hoặc chọn Dùng toàn ảnh.');
  const cropped=await cropper.edit(blob,{signal});
  if(!current(ticket))return;
  if(!cropped){say('Đã hủy. Ảnh chụp chưa được thêm.');return}
  await append([cropped],ticket,{generated:true});
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
 if(preferFileCapture){captureButton.textContent='Ảnh chụp màn hình';captureButton.title='Chụp màn hình bằng phím của máy, chọn ảnh rồi kéo cắt vùng cần hỏi.'}
 listen(captureFile,'change',()=>{
  const file=captureFile.files?.[0];captureFile.value='';
  if(!file||destroyed||pickerTicket!==generation||panel?.hidden)return;
  if(items.length>=ATTACHMENT_LIMITS.count){say('Mỗi câu hỏi gửi tối đa 2 ảnh. Bỏ một ảnh trước khi chụp.');return}
  perform((ticket,signal)=>editCapture(file,ticket,signal));
 });
 listen(captureFile,'cancel',()=>{if(!destroyed&&pickerTicket===generation)say('Đã hủy chọn ảnh chụp. Ảnh đã thêm vẫn được giữ.')});
 listen(captureButton,'click',()=>{
  if(disabled||pending||destroyed)return;
  if(items.length>=ATTACHMENT_LIMITS.count){say('Mỗi câu hỏi gửi tối đa 2 ảnh. Bỏ một ảnh trước khi chụp.');return}
  if(preferFileCapture||!win.isSecureContext||!win.navigator.mediaDevices?.getDisplayMedia){
   pickerTicket=generation;input.blur();say('Chụp màn hình bằng phím của điện thoại, rồi chọn ảnh vừa chụp để cắt vùng cần hỏi.');captureFile.click();return;
  }
  perform(async(ticket,signal)=>{
   // Preserve user activation: call the browser picker before the first await.
   const request=win.navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser'},audio:false});
   const selected=await request;if(!current(ticket)){selected.getTracks().forEach(track=>track.stop());return}stream=selected;
   video=doc.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=stream;
   video.style.cssText='position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px';doc.body.append(video);
   let readyTimer;
   try{await Promise.race([video.play(),new Promise((_,reject)=>{readyTimer=win.setTimeout(()=>reject(Error('Chưa nhận được hình ảnh. Hãy chọn lại tab hoặc dùng Thêm ảnh.')),8000)})])}finally{win.clearTimeout(readyTimer)}
   if(!current(ticket))return;
   const saved=[panel,launcher].filter(Boolean).map(element=>({element,visibility:element.style.visibility}));
   saved.forEach(({element})=>element.style.visibility='hidden');captureRestore=()=>saved.forEach(({element,visibility})=>element.style.visibility=visibility);
   await new Promise(resolve=>win.setTimeout(resolve,150));if(!current(ticket))return;
   const width=video.videoWidth,height=video.videoHeight;
   if(!width||!height)throw Error('Chưa nhận được khung hình. Hãy chọn lại tab hoặc cửa sổ.');
   if(width*height>ATTACHMENT_LIMITS.pixels)throw Error('Nguồn chia sẻ quá lớn. Hãy chọn một cửa sổ nhỏ hơn hoặc Thêm ảnh.');
   // Crop original pixels before the existing 1600px attachment normalization.
   const canvas=doc.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(video,0,0,width,height);
   const blob=await canvasBlob(canvas,.92);if(!current(ticket))return;
   stop();await editCapture(blob,ticket,signal);
  });
 });
 const cancelPending=()=>{generation++;pending=false;const controller=operationController;operationController=null;controller?.abort();cropper.cancel();stop();notify()};
 const clear=()=>{cancelPending();items=[];render();say('')};
 const observer=panel?new win.MutationObserver(()=>{if(panel.hidden&&pending){cancelPending();say('Đã dừng chuẩn bị ảnh. Ảnh đã thêm vẫn ở đây.')}}):null;
 observer?.observe(panel,{attributes:true,attributeFilter:['hidden']});
 listen(win,'pagehide',cancelPending);render();
 return {getImages:()=>items.map(({dataUrl})=>({dataUrl})),clear,cancelPending,get busy(){return pending},setDisabled(value){disabled=Boolean(value);render()},destroy(){destroyed=true;clear();cropper.destroy();observer?.disconnect();listeners.forEach(remove=>remove());if(!captureInput)captureFile.remove()}};
}

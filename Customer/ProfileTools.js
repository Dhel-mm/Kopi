const KopiProfile = (() => {
  async function upload(file) {
    if (!file || !["image/png","image/jpeg"].includes(file.type) || file.size>250*1024) {
      throw new Error("Choose a PNG or JPEG image under 250 KB.");
    }
    const image=await new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error("Could not read image."));
      reader.readAsDataURL(file);
    });
    return KopiApi.request("/me/avatar",{method:"PUT",body:JSON.stringify({image})});
  }
  function avatar(container,image) {
    container.replaceChildren();
    if(image) {
      const img=document.createElement("img");img.src=image;img.alt="Profile photo";
      img.style.cssText="width:100%;height:100%;object-fit:cover;border-radius:50%";
      container.appendChild(img);
    }else{
      const icon=document.createElement("i");icon.className="bi bi-person-circle";icon.setAttribute("aria-hidden","true");
      container.appendChild(icon);
    }
  }
  async function save(form) {
    const data=Object.fromEntries(new FormData(form));
    if (data.newPassword!==data.confirmPassword) throw new Error("The new passwords do not match.");
    if (data.newPassword && data.newPassword.length<8) throw new Error("Use at least 8 characters for your new password.");
    const result=await KopiApi.request("/me",{method:"PUT",body:JSON.stringify(data)});
    KopiApi.saveSession(result);
    for(const name of ["currentPassword","newPassword","confirmPassword"]) if(form.elements[name])form.elements[name].value="";
    return result;
  }
  return {upload,avatar,save};
})();

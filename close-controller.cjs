function createCloseController({getState,choose,save,finish,onError}) {
  let busy=false;
  return async function requestClose(){
    if(busy)return false;busy=true;
    try{
      const state=await getState();
      if(state.dirty){const response=await choose(state);if(response===2)return false;if(response===0&&!await save(state))return false;}
      finish();return true;
    }catch(error){await onError(error);return false;}finally{busy=false;}
  };
}
module.exports={createCloseController};

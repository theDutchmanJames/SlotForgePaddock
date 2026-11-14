'use strict';
const path=require('node:path');
// Desktop-only metadata for the already opened, identity-checked main Store.
// Do not resolve/bootstrap another library, inspect peers, or hydrate records.
function libraryStatus(store,root){
 return {shared:!!root,databaseId:store.data.id,name:store.data.settings.name,
  file:store.file||'',folder:store.file?path.dirname(store.file):'',
  registrationFolder:root||''};
}
module.exports={libraryStatus};

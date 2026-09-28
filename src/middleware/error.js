function notFound(req,res){res.status(404).json({error:'Endpoint not found.',path:req.path});}
function errorHandler(err,req,res,next){
  if(res.headersSent)return next(err);
  const status=Number(err.status)||500;
  if(status>=500){
    console.error('API request failed',{name:err.name,code:err.code,errno:err.errno,path:req.path});
    return res.status(status).json({error:'The server could not complete the request. Please try again.'});
  }
  console.error('API request rejected',{status,path:req.path,message:err.message});
  return res.status(status).json({error:err.message||'Request failed.'});
}
module.exports={notFound,errorHandler};

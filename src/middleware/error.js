const { randomUUID } = require('node:crypto');

function notFound(req,res){res.status(404).json({error:'Endpoint not found.',path:req.path});}
function errorHandler(err,req,res,next){
  if(res.headersSent)return next(err);
  const status=Number(err.status)||500;
  if(status>=500){
    const requestId=randomUUID();
    const context={
      requestId,
      method:req.method,
      path:req.path,
      entity:typeof req.query?.entity==='string'?req.query.entity.slice(0,48):undefined,
      action:typeof req.query?.action==='string'?req.query.action.slice(0,48):undefined,
      name:err.name,
      code:err.code,
      errno:err.errno,
      sqlState:err.sqlState,
    };
    if(['ER_BAD_FIELD_ERROR','ER_NO_SUCH_TABLE'].includes(err.code)){
      context.databaseMessage=String(err.message||'').slice(0,180);
    }
    console.error('API request failed',context);
    return res.status(status).json({
      error:'The server could not complete the request. Please try again.',
      request_id:requestId,
    });
  }
  console.error('API request rejected',{status,path:req.path,message:err.message});
  return res.status(status).json({error:err.message||'Request failed.'});
}
module.exports={notFound,errorHandler};

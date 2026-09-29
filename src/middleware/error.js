const { randomUUID } = require('node:crypto');
const isProduction = () => process.env.NODE_ENV === 'production';

function safeDevelopmentMessage(error){
  return String(error?.message || 'Request failed.')
    .replace(/(password|passwd|pwd|token|secret|api[_-]?key)(\s*[=:]\s*)([^\s,;]+)/gi, '$1$2[redacted]')
    .slice(0, 500);
}

function safeServerMessage(error){
  return safeDevelopmentMessage(error)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/Duplicate entry '.{1,160}?' for key/gi, 'Duplicate entry [redacted] for key');
}

function safeStackTrace(error){
  return String(error?.stack || '')
    .split('\n')
    .slice(1)
    .filter((line) => /^\s+at\s/.test(line))
    .slice(0, 12)
    .join('\n');
}

function notFound(req,res){res.status(404).json({error:'Endpoint not found.',path:req.path});}
function errorHandler(err,req,res,next){
  if(res.headersSent)return next(err);
  const status=Number(err.status)||500;
  if(status>=500){
    const requestId=req.requestId||randomUUID();
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
      message:safeServerMessage(err),
      stack:safeStackTrace(err),
      ...(err.bookingStage?{bookingStage:err.bookingStage}:{}),
    };
    if(['ER_BAD_FIELD_ERROR','ER_NO_SUCH_TABLE'].includes(err.code)){
      context.databaseMessage=String(err.message||'').slice(0,180);
    }
    if(!isProduction())context.details=safeDevelopmentMessage(err);
    console.error('API request failed',context);
    return res.status(status).json({
      error:'The server could not complete the request. Please try again.',
      error_code:isProduction()?'INTERNAL_SERVER_ERROR':(err.code||'INTERNAL_SERVER_ERROR'),
      ...(!isProduction()?{details:safeDevelopmentMessage(err)}:{}),
      request_id:requestId,
    });
  }
  console.error('API request rejected',{status,path:req.path,message:err.message});
  return res.status(status).json({error:err.message||'Request failed.'});
}
module.exports={notFound,errorHandler};

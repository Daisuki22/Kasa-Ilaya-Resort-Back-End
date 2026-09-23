function notFound(req,res){res.status(404).json({error:'Endpoint not found.',path:req.path});}
function errorHandler(err,req,res,next){console.error(err); if(res.headersSent)return next(err);res.status(err.status||500).json({error:err.message||'Internal server error.'});}
module.exports={notFound,errorHandler};

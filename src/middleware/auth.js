const jwt=require('jsonwebtoken'); const config=require('../config/env'); const {findUserById,publicUser}=require('../utils');
function tokenFrom(req){const h=req.headers.authorization||''; if(h.startsWith('Bearer '))return h.slice(7); if(req.cookies?.kasa_token)return req.cookies.kasa_token; return null;}
async function auth(req,res,next){try{const t=tokenFrom(req); if(!t){req.user=null;return next();} const p=jwt.verify(t,config.jwtSecret); const u=await findUserById(p.sub); if(!u||u.disabled) {req.user=null;return next();} req.user=u; req.publicUser=publicUser(u); next();}catch(e){req.user=null;next();}}
function requireAuth(req,res,next){if(!req.user)return res.status(401).json({error:'Not authenticated.'}); next();}
function requireAdmin(req,res,next){if(!req.user||!['admin','super_admin'].includes(req.user.role||req.user.app_role))return res.status(403).json({error:'Forbidden.'});next();}
module.exports={auth,requireAuth,requireAdmin};

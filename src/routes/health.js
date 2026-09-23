const express=require('express'); const {testConnection}=require('../config/database'); const router=express.Router();
router.get('/',async(req,res)=>{try{await testConnection();res.json({success:true,service:'Kasa Ilaya Resort API',database:'connected',environment:process.env.NODE_ENV||'development'});}catch(e){console.error('TiDB connection error:',e.message);res.status(503).json({success:false,service:'Kasa Ilaya Resort API',database:'disconnected',error:e.message});}});
module.exports=router;

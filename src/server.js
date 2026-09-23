const express=require('express');const cors=require('cors');const helmet=require('helmet');const morgan=require('morgan');const cookieParser=require('cookie-parser');
const config=require('./config/env');const {ensureRuntimeSchema}=require('./config/database');const {auth}=require('./middleware/auth');const {notFound,errorHandler}=require('./middleware/error');
const health=require('./routes/health');const authRoutes=require('./routes/auth');const entities=require('./routes/entities');const inquiries=require('./routes/inquiries');const integrations=require('./routes/integrations');
const app=express();app.disable('x-powered-by');app.set('trust proxy',1);app.use(helmet({crossOriginResourcePolicy:{policy:'cross-origin'}}));app.use(cookieParser());app.use(cors({origin:(origin,cb)=>{if(!origin||!config.frontendUrl||origin===config.frontendUrl)return cb(null,true);return cb(new Error('CORS origin not allowed'));},credentials:true}));app.use(express.json({limit:'10mb'}));app.use(express.urlencoded({extended:true,limit:'10mb'}));app.use(morgan(config.nodeEnv==='production'?'combined':'dev'));app.use(['/uploads','/api/uploads'],express.static(require('path').join(process.cwd(),'uploads')));
app.get('/',(req,res)=>res.json({success:true,service:'Kasa Ilaya Resort API',version:'2.0.0'}));app.use('/api/health',health);
// New clean Node endpoints
app.use('/api/auth', authRoutes);app.use('/api/entities',entities);app.use('/api/inquiries',inquiries);app.use('/api/integrations',integrations);
// Legacy PHP-compatible URLs so the existing Vercel frontend can work without rewriting every fetch immediately.
app.use('/api/auth.php', auth, authRoutes);app.use('/api/entities.php',entities);app.use('/api/inquiries.php',inquiries);app.use('/api/integrations.php',integrations);
app.use(notFound);app.use(errorHandler);
ensureRuntimeSchema()
  .then(()=>app.listen(config.port,'0.0.0.0',()=>console.log(`Kasa Ilaya Resort Node API listening on port ${config.port}`)))
  .catch((error)=>{console.error('Failed to prepare database schema',error);process.exit(1);});

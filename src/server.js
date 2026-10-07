const express=require('express');const cors=require('cors');const helmet=require('helmet');const morgan=require('morgan');const cookieParser=require('cookie-parser');
const fs=require('node:fs');const path=require('node:path');
const {randomUUID}=require('node:crypto');
const config=require('./config/env');const {auth}=require('./middleware/auth');const {notFound,errorHandler}=require('./middleware/error');
const {uploadsDir,bundledUploadsDir}=require('./config/uploads');
const health=require('./routes/health');const authRoutes=require('./routes/auth');const entities=require('./routes/entities');const inquiries=require('./routes/inquiries');const integrations=require('./routes/integrations');
const {sendUpcomingBookingReminders}=require('./services/notifications');
const {expirePastPendingBookings}=require('./services/bookingExpiration');
const preferWebp=(root)=> (req,res,next)=>{if(!['GET','HEAD'].includes(req.method)||!String(req.headers.accept||'').includes('image/webp'))return next();try{const parsed=new URL(req.url,'http://local.invalid');const relativePath=decodeURIComponent(parsed.pathname).replace(/^[/\\]+/,'');const extension=path.extname(relativePath);if(!['.jpg','.jpeg','.png'].includes(extension.toLowerCase()))return next();const rootPath=path.resolve(root);const webpPath=path.resolve(rootPath,relativePath.slice(0,-extension.length)+'.webp');if(!webpPath.startsWith(rootPath+path.sep)||!fs.existsSync(webpPath)||!fs.statSync(webpPath).isFile())return next();req.url=`${parsed.pathname.slice(0,-extension.length)}.webp${parsed.search}`;res.vary('Accept');return next();}catch{return next();}};
const app=express();app.disable('x-powered-by');app.set('trust proxy',1);app.use((req,res,next)=>{req.requestId=randomUUID();res.setHeader('X-Request-Id',req.requestId);next();});app.use(helmet({crossOriginResourcePolicy:{policy:'cross-origin'}}));app.use(cookieParser());const configuredOrigins = String(config.frontendUrl || '').split(',').map(v=>v.trim().replace(/\/$/, '')).filter(Boolean);const allowedOrigins = new Set(configuredOrigins.length ? configuredOrigins : config.nodeEnv === 'production' ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']);
app.use(cors({origin:(origin,cb)=>{if(!origin||allowedOrigins.has(String(origin).replace(/\/$/, '')))return cb(null,true);return cb(new Error('CORS origin not allowed'));},credentials:true}));app.use(express.json({limit:'10mb'}));app.use(express.urlencoded({extended:true,limit:'10mb'}));app.use(morgan(config.nodeEnv==='production'?'combined':'dev'));const staticImageCache={maxAge:'1y',immutable:true};app.use(['/uploads','/api/uploads'],preferWebp(uploadsDir),express.static(uploadsDir,staticImageCache),preferWebp(bundledUploadsDir),express.static(bundledUploadsDir,staticImageCache));
app.get('/',(req,res)=>res.json({success:true,service:'Kasa Ilaya Resort API',version:'2.0.0'}));app.use('/api/health',health);
// New clean Node endpoints
app.use('/api/auth', auth, authRoutes);app.use('/api/entities',entities);app.use('/api/inquiries',inquiries);app.use('/api/integrations',integrations);
// Legacy PHP-compatible URLs so the existing Vercel frontend can work without rewriting every fetch immediately.
app.use('/api/auth.php', auth, authRoutes);app.use('/api/entities.php',entities);app.use('/api/inquiries.php',inquiries);app.use('/api/integrations.php',integrations);
app.use(notFound);app.use(errorHandler);
if(config.nodeEnv==='production'&&!process.env.KASA_UPLOADS_DIR)console.warn('KASA_UPLOADS_DIR is not configured; uploaded booking proofs may be lost when the Render instance is replaced. Attach a persistent disk and set KASA_UPLOADS_DIR to its mount path.');
app.listen(config.port, '0.0.0.0', () => {
  console.log(
    `Kasa Ilaya Resort Node API listening on port ${config.port}`
  );
});
const reminderTimer=setInterval(()=>{void sendUpcomingBookingReminders().catch(error=>console.error('Upcoming booking reminder check failed',{code:error.code}));},15*60*1000);
reminderTimer.unref();
void sendUpcomingBookingReminders().catch(error=>console.error('Initial upcoming booking reminder check failed',{code:error.code}));
const bookingExpirationTimer=setInterval(()=>{void expirePastPendingBookings().catch(error=>console.error('Pending booking expiration failed',{code:error.code,errno:error.errno,sqlState:error.sqlState}));},15*60*1000);
bookingExpirationTimer.unref();
void expirePastPendingBookings().catch(error=>console.error('Initial pending booking expiration failed',{code:error.code,errno:error.errno,sqlState:error.sqlState}));

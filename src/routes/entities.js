const express=require('express'); const router=express.Router(); const {pool}=require('../config/database'); const {id,now,publicUser,isAdmin}=require('../utils'); const {auth}=require('../middleware/auth');
const {randomUUID}=require('node:crypto');
const {ACTIVE_BOOKING_STATUSES,addDateKeyDays,dateKeyFromDate,getBookingStartDateTime,getTourTime,isScheduleAvailable,isValidDateKey}=require('../services/bookingSchedule');
const BOOKING_SCHEDULE_LOCK='kasa_ilaya_booking_schedule';
const MAP={
 ActivityLog:{table:'activity_logs',fields:['id','created_date','updated_date','user_email','user_name','action','entity_type','entity_id','details']},
 Booking:{table:'bookings',fields:['id','created_date','updated_date','booking_reference','package_id','package_name','tour_type','booking_date','guest_count','customer_name','customer_email','customer_phone','special_requests','total_amount','reservation_fee_amount','payment_type','payment_amount_due','payment_mode','payment_qr_code_id','payment_qr_code_label','receipt_url','status','payment_status','additional_fee_amount','additional_fee_reason','additional_fee_status','rebooking_status','rebooking_original_date','rebooking_requested_date','rebooking_reason','rebooking_requested_at','rebooking_resolved_at','rebooking_resolution_note','rebooking_count']},
 FoundItem:{table:'found_items',fields:['id','created_date','updated_date','item_name','description','date_found','location_found','found_by','status','image_url','claimed_guest_name','claimed_contact','claimed_reservation_id','proof_of_ownership','released_by','date_claimed','is_active']},
 LostItemReport:{table:'lost_item_reports',fields:['id','created_date','updated_date','guest_name','reservation_number','item_lost','description','date_lost','contact_number','email','status','matched_item_id']},
 Package:{table:'packages',fields:['id','created_date','updated_date','name','description','tour_type','price','day_tour_price','night_tour_price','twenty_two_hour_price','max_guests','inclusions','gallery_images','image_url','is_active'],json:['inclusions','gallery_images'],bool:['is_active'],numeric:['price','day_tour_price','night_tour_price','twenty_two_hour_price','max_guests']},
 PaymentQrCode:{table:'payment_qr_codes',fields:['id','created_date','updated_date','label','account_name','account_number','instructions','image_url','display_order','is_active'],bool:['is_active'],numeric:['display_order']},
 ResortRule:{table:'resort_rules',fields:['id','created_date','updated_date','title','description','sort_order','is_active'],bool:['is_active'],numeric:['sort_order']},
 SiteSetting:{table:'site_settings',fields:['id','created_date','updated_date','site_name','logo_url','hero_image_url','hero_images_json','packages_banner_url','packages_banner_images_json','hero_badge_text','hero_title_line1','hero_title_line2','hero_description','body_font_style','heading_font_style','amenities_section_label','amenities_section_title','amenities_section_description','resort_gallery_json','terms_title','terms_summary','terms_content','amenities_json','require_strong_password','min_password_length','session_timeout_minutes','max_login_attempts','lockout_minutes','enable_login_notifications'],bool:['require_strong_password','enable_login_notifications'],numeric:['min_password_length','session_timeout_minutes','max_login_attempts','lockout_minutes'],json:['hero_images_json','packages_banner_images_json','resort_gallery_json','amenities_json']},
 User:{table:'users',fields:['id','created_date','updated_date','email','full_name','birth_date','phone','profile_image_url','role','disabled','is_verified','app_id','is_service','app_role'],bool:['disabled','is_verified','is_service']},
 UpcomingSchedule:{table:'upcoming_schedules',fields:['id','created_date','updated_date','title','schedule_date','start_time','end_time','location','description','created_by_name','created_by_email']},
 Review:{table:'reviews',fields:['id','created_date','updated_date','booking_id','booking_reference','guest_name','guest_email','package_name','rating','review_text','is_approved'],bool:['is_approved'],numeric:['rating']}
};
function deserialize(cfg,row){const out={...row};for(const f of cfg.json||[]){if(out[f]!==null&&out[f]!==undefined){try{out[f]=typeof out[f]==='string'?JSON.parse(out[f]):out[f];}catch{out[f]=[];}}}for(const f of cfg.bool||[])if(f in out)out[f]=!!out[f];for(const f of cfg.numeric||[])if(out[f]!==null&&out[f]!==undefined){const n=Number(out[f]);out[f]=Number.isInteger(n)?n:n;}for(const f of ['created_date','updated_date'])if(out[f] instanceof Date)out[f]=out[f].toISOString();return out;}
function serialize(cfg,f,v){if((cfg.json||[]).includes(f))return v==null?null:JSON.stringify(v);if((cfg.bool||[]).includes(f))return v?1:0;return v;}
async function getScheduleRows(db,fromDate,toDate,forUpdate=false){const statusSlots=ACTIVE_BOOKING_STATUSES.map(()=>'?').join(',');const lock=forUpdate?' FOR UPDATE':'';const [bookings]=await db.query(`SELECT id,DATE_FORMAT(booking_date,'%Y-%m-%d') AS booking_date,tour_type,status FROM bookings WHERE status IN (${statusSlots}) AND booking_date BETWEEN ? AND ?${lock}`,[...ACTIVE_BOOKING_STATUSES,fromDate,toDate]);const [schedules]=await db.query(`SELECT DATE_FORMAT(schedule_date,'%Y-%m-%d') AS schedule_date FROM upcoming_schedules WHERE schedule_date BETWEEN ? AND ?${lock}`,[fromDate,toDate]);return {bookings,manualDates:schedules.map(row=>row.schedule_date)};}
async function databaseScheduleIsAvailable(db,bookingDate,tourType,excludeBookingId=null,forUpdate=false){const fromDate=addDateKeyDays(bookingDate,-1);const toDate=addDateKeyDays(bookingDate,tourType==='22_hours'?1:0);const {bookings,manualDates}=await getScheduleRows(db,fromDate,toDate,forUpdate);return isScheduleAvailable({bookingDate,tourType,bookings,manualDates,excludeBookingId});}
function httpError(message,status){return Object.assign(new Error(message),{status});}
async function releaseNamedLock(connection){try{await connection.query('SELECT RELEASE_LOCK(?)',[BOOKING_SCHEDULE_LOCK]);}catch{}}
async function sendAvailability(req,res){const today=dateKeyFromDate(new Date());const excludeId=String(req.query.exclude_id||'');let verifiedExcludeId=null;if(excludeId&&req.user){const [owned]=await pool.query('SELECT id FROM bookings WHERE id=? AND LOWER(customer_email)=LOWER(?) LIMIT 1',[excludeId,req.user.email]);verifiedExcludeId=owned[0]?.id||null;}const excludeClause=verifiedExcludeId?' AND id<>?':'';const bookingParams=[...ACTIVE_BOOKING_STATUSES,today];if(verifiedExcludeId)bookingParams.push(verifiedExcludeId);const [bookings]=await pool.query(`SELECT DATE_FORMAT(booking_date,'%Y-%m-%d') AS booking_date,tour_type FROM bookings WHERE status IN (${ACTIVE_BOOKING_STATUSES.map(()=>'?').join(',')}) AND booking_date>=?${excludeClause}`,bookingParams);const [schedules]=await pool.query("SELECT DATE_FORMAT(schedule_date,'%Y-%m-%d') AS schedule_date FROM upcoming_schedules WHERE schedule_date>=?",[today]);return res.json({booking_dates:bookings,manual_schedule_dates:schedules.map(row=>row.schedule_date)});}
async function rescheduleBooking(req,res){
 if(!req.user)return res.status(401).json({error:'Not authenticated.'});
 const bookingId=String(req.query.id||'');
 if(!bookingId)return res.status(422).json({error:'Missing booking id.'});
 const body=req.body||{};
 if(Object.keys(body).some(key=>!['booking_date','note'].includes(key))||!isValidDateKey(body.booking_date))return res.status(422).json({error:'A valid new booking date is required.'});
 const note=typeof body.note==='string'?body.note.trim().slice(0,500):'';
 const admin=isAdmin(req.user);
 let connection;
 let lockAcquired=false;
 let transactionStarted=false;
 let phase='acquire_connection';
 try{
  connection=await pool.getConnection();
  phase='acquire_schedule_lock';
  const [lockRows]=await connection.query('SELECT GET_LOCK(?,10) AS acquired',[BOOKING_SCHEDULE_LOCK]);
  lockAcquired=Number(lockRows[0]?.acquired)===1;
  if(!lockAcquired)throw httpError('Schedule is busy. Please try again.',503);
  phase='begin_transaction';
  await connection.beginTransaction();
  transactionStarted=true;
  phase='load_booking';
  const [rows]=await connection.query('SELECT * FROM bookings WHERE id=? FOR UPDATE',[bookingId]);
  const booking=rows[0];
  if(!booking)throw httpError('Reservation not found.',404);
  if(!admin&&String(booking.customer_email||'').toLowerCase()!==String(req.user.email||'').toLowerCase())throw httpError('You are not authorized to reschedule this reservation.',403);
  if(!['pending','confirmed'].includes(booking.status))throw httpError('This reservation can no longer be rescheduled.',409);
  if(!admin&&((booking.rebooking_status||'none')==='pending'||Number(booking.rebooking_count||0)>=1))throw httpError('This reservation is not eligible for another reschedule.',409);
  if(body.booking_date===String(booking.booking_date).slice(0,10))throw httpError('Choose a different date from the current reservation.',422);
  const today=dateKeyFromDate(new Date());
  if(body.booking_date<=today)throw httpError('Choose a future date for your reservation.',422);
  const startTime=getBookingStartDateTime(body.booking_date,booking.tour_type);
  if(!startTime||!getTourTime(booking.tour_type))throw httpError('This reservation has an invalid tour schedule.',422);
  if(!admin){
   const originalStart=getBookingStartDateTime(String(booking.booking_date).slice(0,10),booking.tour_type);
   if(!originalStart)throw httpError('This reservation date cannot be checked.',422);
   const cutoff=originalStart.getTime()-7*24*60*60*1000;
   if(Date.now()>cutoff)throw httpError('Reschedule requests must be submitted at least 7 days before the reservation date.',409);
  }
  phase='validate_schedule_availability';
  const available=await databaseScheduleIsAvailable(connection,body.booking_date,booking.tour_type,booking.id,true);
  if(!available)throw httpError('The selected schedule is unavailable. Please choose another date or time.',409);
  const originalDate=String(booking.booking_date).slice(0,10);
  const resolutionNote=note||(admin?'Rescheduled by resort administrator.':'Rescheduled by guest.');
  phase='update_booking';
  await connection.query("UPDATE bookings SET booking_date=?,rebooking_status='approved',rebooking_original_date=?,rebooking_requested_date=?,rebooking_requested_at=NOW(),rebooking_resolved_at=NOW(),rebooking_resolution_note=?,rebooking_count=COALESCE(rebooking_count,0)+1,updated_date=NOW() WHERE id=?",[body.booking_date,originalDate,body.booking_date,resolutionNote,booking.id]);
  const oldTime=getTourTime(booking.tour_type);
  const newTime=getTourTime(booking.tour_type);
  const details=`${admin?'Admin':'Customer'} rescheduled ${booking.booking_reference} (booking ${booking.id}) from ${originalDate} ${oldTime.label} to ${body.booking_date} ${newTime.label}. Package: ${booking.package_name}. Guests: ${booking.guest_count}. Payment status preserved: ${booking.payment_status}.`;
  phase='write_activity_log';
  await connection.query('INSERT INTO activity_logs (id,created_date,updated_date,user_email,user_name,action,entity_type,entity_id,details) VALUES (?,?,?,?,?,?,?,?,?)',[id('activitylog'),now(),now(),req.user.email||null,req.user.full_name||req.user.name||'Guest','Reservation Rescheduled','Booking',booking.id,details]);
  phase='reload_booking';
  const [updatedRows]=await connection.query('SELECT * FROM bookings WHERE id=? LIMIT 1',[booking.id]);
  if(!updatedRows[0])throw new Error('Updated reservation could not be reloaded.');
  phase='commit_transaction';
  await connection.commit();
  transactionStarted=false;
  return res.json({success:true,data:deserialize(MAP.Booking,updatedRows[0])});
 }catch(error){
  if(transactionStarted)try{await connection.rollback();}catch{}
  const status=error.status||500;
  if(status>=500){
   const requestId=randomUUID();
   console.error('Reservation reschedule failed',{requestId,phase,code:error.code,errno:error.errno,sqlState:error.sqlState});
   return res.status(status).json({
    error:status===500?'Unable to reschedule reservation. Your existing reservation was not changed.':error.message,
    request_id:requestId,
   });
  }
  return res.status(status).json({error:error.message});
 }finally{
  if(connection){
   if(lockAcquired)await releaseNamedLock(connection);
   connection.release();
  }
 }
}
async function bookingAction(req,res,next){try{const entity=String(req.query.entity||'');const action=String(req.query.action||'');if(entity!=='Booking')return next();if(req.method==='GET'&&action==='availability')return sendAvailability(req,res);if(req.method==='PATCH'&&action==='reschedule')return rescheduleBooking(req,res);if(['PATCH','PUT'].includes(req.method)&&Object.prototype.hasOwnProperty.call(req.body||{},'booking_date'))return res.status(400).json({error:'Use the reschedule action to change a reservation date.'});return next();}catch(error){return next(error);}}
async function bookingCreationLock(req,res,next){const entity=String(req.query.entity||'');const bookingCreate=req.method==='POST'&&entity==='Booking';const manualScheduleWrite=entity==='UpcomingSchedule'&&(req.method==='POST'||(['PATCH','PUT'].includes(req.method)&&Object.prototype.hasOwnProperty.call(req.body||{},'schedule_date')));if((!bookingCreate&&!manualScheduleWrite)||!req.user)return next();let connection;let acquired=false;let released=false;const release=async()=>{if(released||!connection)return;released=true;if(acquired)await releaseNamedLock(connection);connection.release();};try{connection=await pool.getConnection();const [rows]=await connection.query('SELECT GET_LOCK(?,10) AS acquired',[BOOKING_SCHEDULE_LOCK]);acquired=Number(rows[0]?.acquired)===1;if(!acquired){connection.release();return res.status(503).json({error:'Schedule is busy. Please try again.'});}res.once('finish',release);res.once('close',release);return next();}catch(error){if(connection&&!acquired)connection.release();return next(error);}}
async function validate(entity,record,exclude){
 if(entity==='Package'){
  if(!String(record.name||'').trim())throw Object.assign(new Error('Package name is required.'),{status:422});
  const prices=['day_tour_price','night_tour_price','twenty_two_hour_price','price'].map(x=>Number(record[x]||0));
  if(Math.max(...prices)<=0)throw Object.assign(new Error('Please add at least one package price.'),{status:422});
  if(record.is_active!==false){const [r]=await pool.query('SELECT id FROM packages WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) AND is_active=1 AND id<>? LIMIT 1',[record.name,exclude||'']);if(r[0])throw Object.assign(new Error('An active package with this name already exists.'),{status:409});}
 }
 if(entity==='Booking'){
  const date=String(record.booking_date||'');
  if(!isValidDateKey(date)||!getTourTime(record.tour_type))throw Object.assign(new Error('Booking date and tour type must be valid.'),{status:422});
  const guests=Number(record.guest_count||0);
  if(guests<1)throw Object.assign(new Error('Guest count must be at least 1.'),{status:422});
  if(record.package_id){const [p]=await pool.query('SELECT max_guests FROM packages WHERE id=? LIMIT 1',[record.package_id]);if(p[0]&&guests>Number(p[0].max_guests))throw Object.assign(new Error(`This package allows a maximum of ${p[0].max_guests} guests.`),{status:422});}
  if(!exclude&&!await databaseScheduleIsAvailable(pool,date,record.tour_type))throw Object.assign(new Error('The selected schedule is unavailable. Please choose another date or time.'),{status:409});
 }
 if(entity==='Review'){const rating=Number(record.rating||0);if(rating<1||rating>5)throw Object.assign(new Error('Rating must be between 1 and 5.'),{status:422});}
}
async function enforceBookingNotice(req,res,next){try{const entity=String(req.query.entity||'');const patch=req.body||{};const cancelling=patch.status==='cancelled';const rebooking=patch.rebooking_status==='requested';if(!['PATCH','PUT'].includes(req.method)||entity!=='Booking'||(!cancelling&&!rebooking)||isAdmin(req.user))return next();const rid=String(req.query.id||'');if(!rid)return next();const [rows]=await pool.query('SELECT * FROM bookings WHERE id=? LIMIT 1',[rid]);const booking=rows[0];if(!booking||String(booking.customer_email).toLowerCase()!==String(req.user?.email||'').toLowerCase())return next();if(cancelling&&(booking.status!=='pending'||(booking.payment_status||'unpaid')==='paid'))return res.status(409).json({error:'Only unpaid pending bookings can be cancelled online.'});if(rebooking&&(!['pending','confirmed'].includes(booking.status)||(booking.rebooking_status||'none')==='pending'||Number(booking.rebooking_count||0)>=1))return res.status(409).json({error:'This booking is not eligible for another rebooking request.'});const date=String(booking.booking_date||'');const startHour=booking.tour_type==='day_tour'?'08:00:00':['night_tour','22_hours'].includes(booking.tour_type)?'18:00:00':'';if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!startHour)return res.status(422).json({error:'This booking date cannot be checked for cancellation or rebooking.'});const startTime=new Date(`${date}T${startHour}+08:00`);if(Number.isNaN(startTime.getTime()))return res.status(422).json({error:'This booking date cannot be checked for cancellation or rebooking.'});const cutoff=startTime.getTime()-7*24*60*60*1000;if(Date.now()>cutoff)return res.status(409).json({error:'Cancellation and rebooking requests must be submitted at least 7 days before the reservation date. Requests within 7 days are not permitted.'});return next();}catch(error){return next(error);}}
async function handler(req,res,next){try{const entity=String(req.query.entity||'');const cfg=MAP[entity];if(!cfg)return res.status(404).json({error:`Unsupported entity: ${entity}`});const table=cfg.table;const fields=cfg.fields;const method=req.method;const admin=isAdmin(req.user);if(entity==='LostItemReport'&&!admin)return res.status(403).json({error:'Forbidden.'});if(['ActivityLog','User'].includes(entity)&&!admin&&(method!=='GET'||!req.user))return res.status(403).json({error:'Forbidden.'});if(entity==='User'&&req.user?.role!=='super_admin'&&req.user?.app_role!=='super_admin')return res.status(403).json({error:'Forbidden.'});if(!admin&&['Booking','PaymentQrCode','SiteSetting'].includes(entity)&&method!=='GET')return res.status(403).json({error:'Forbidden.'});if(!admin&&entity==='Review'&&method!=='GET'&&method!=='POST')return res.status(403).json({error:'Forbidden.'});if(!admin&&['Package','ResortRule','UpcomingSchedule','FoundItem'].includes(entity)&&!['GET','POST'].includes(method))return res.status(403).json({error:'Forbidden.'});
if(method==='GET'){const where=[],vals=[];let filter={};try{filter=req.query.filter?JSON.parse(req.query.filter):{};}catch{}for(const [f,v] of Object.entries(filter)){if(!fields.includes(f))continue;if(Array.isArray(v)&&v.length){where.push(`\`${f}\` IN (${v.map(()=>'?').join(',')})`);vals.push(...v.map(x=>serialize(cfg,f,x)));}else{where.push(`\`${f}\`=?`);vals.push(serialize(cfg,f,v));}}if(!admin&&['Package','PaymentQrCode','ResortRule','FoundItem'].includes(entity)){where.push('is_active=1');}if(!admin&&entity==='Review'){where.push('is_approved=1');}if(entity==='ActivityLog'&&!admin){if(!req.user)return res.status(403).json({error:'Forbidden.'});where.push('user_email=?');vals.push(req.user.email);}if(entity==='Booking'&&!admin&&req.user){where.push('LOWER(customer_email)=LOWER(?)');vals.push(req.user.email);}if(entity==='Booking'&&!req.user&&!filter.customer_email){where.push("status IN ('pending','confirmed','completed')");}let sql=`SELECT * FROM \`${table}\``;if(where.length)sql+=' WHERE '+where.join(' AND ');const sort=String(req.query.sort||'');if(sort){const desc=sort.startsWith('-'),sf=desc?sort.slice(1):sort;if(fields.includes(sf))sql+=` ORDER BY \`${sf}\` ${desc?'DESC':'ASC'}`;}if(/^\d+$/.test(String(req.query.limit||'')))sql+=` LIMIT ${Math.min(500,Number(req.query.limit))}`;const [rows]=await pool.query(sql,vals);return res.json(rows.map(r=>{const item=deserialize(cfg,r);if(entity==='Booking'&&!admin&&(!req.user||String(item.customer_email||'').toLowerCase()!==String(req.user.email||'').toLowerCase()))return {id:item.id,package_id:item.package_id,package_name:item.package_name,tour_type:item.tour_type,booking_date:item.booking_date,guest_count:item.guest_count,status:item.status};return item;}));}
if(method==='POST'){if(!admin&&!['ActivityLog','Booking','Review'].includes(entity)&&!(entity==='FoundItem'&&req.user))return res.status(403).json({error:'Forbidden.'});if(!req.user&&['ActivityLog','Booking','Review','FoundItem'].includes(entity))return res.status(401).json({error:'Not authenticated.'});const p=req.body||{},n=now(),record={};for(const f of fields)if(Object.prototype.hasOwnProperty.call(p,f))record[f]=p[f];record.id=record.id||id(entity.toLowerCase());record.created_date=record.created_date||n;record.updated_date=n;if(entity==='ActivityLog'&&!admin){record.user_email=req.user.email;record.user_name=req.user.full_name;}if(entity==='Booking'){record.customer_email=req.user.email;record.booking_reference=record.booking_reference||`KI-${cryptoRandom(4)}`;record.status='pending';record.payment_status=record.receipt_url?'pending_verification':'unpaid';}if(entity==='Review'&&!admin){const [bookings]=await pool.query('SELECT id,booking_reference,package_name,customer_name,customer_email,status FROM bookings WHERE id=? LIMIT 1',[record.booking_id]);const booking=bookings[0];if(!booking||String(booking.customer_email).toLowerCase()!==String(req.user.email).toLowerCase()||booking.status!=='completed')return res.status(403).json({error:'A review can only be submitted for your completed booking.'});Object.assign(record,{booking_reference:booking.booking_reference,package_name:booking.package_name,guest_name:booking.customer_name,guest_email:booking.customer_email});}if(entity==='FoundItem'&&!admin){delete record.is_active;delete record.status;record.found_by=req.user.full_name||req.user.email;record.status='unclaimed';record.is_active=false;}if(entity==='Package'){record.is_active=record.is_active!==false;record.price=Number(record.price||0);record.max_guests=Number(record.max_guests||1);}if(entity==='FoundItem'&&admin)record.status=record.status||'unclaimed';if(entity==='LostItemReport')record.status=record.status||'searching';await validate(entity,record);const cols=[],qs=[],vals=[];for(const f of fields)if(Object.prototype.hasOwnProperty.call(record,f)){cols.push(`\`${f}\``);qs.push('?');vals.push(serialize(cfg,f,record[f]));}await pool.query(`INSERT INTO \`${table}\` (${cols.join(',')}) VALUES (${qs.join(',')})`,vals);const [r]=await pool.query(`SELECT * FROM \`${table}\` WHERE id=? LIMIT 1`,[record.id]);return res.status(201).json(deserialize(cfg,r[0]||record));}
if(['PATCH','PUT'].includes(method)){const rid=String(req.query.id||'');if(!rid)return res.status(422).json({error:'Missing entity id.'});const [existing]=await pool.query(`SELECT * FROM \`${table}\` WHERE id=? LIMIT 1`,[rid]);if(!existing[0])return res.status(404).json({error:'Record not found.'});if(!admin){if(entity!=='Booking'||String(existing[0].customer_email).toLowerCase()!==String(req.user?.email||'').toLowerCase())return res.status(403).json({error:'Forbidden.'});const patch=req.body||{};const allowed=new Set(['status','rebooking_status','rebooking_original_date','rebooking_requested_date','rebooking_reason','rebooking_requested_at']);if(Object.keys(patch).some(key=>!allowed.has(key))||(patch.status&&patch.status!=='cancelled')||(patch.rebooking_status&&patch.rebooking_status!=='requested'))return res.status(403).json({error:'Forbidden.'});}const record={...existing[0],...(req.body||{}),updated_date:now()};await validate(entity,record,rid);const updates=[],vals=[];for(const f of fields)if(f!=='id'&&Object.prototype.hasOwnProperty.call(req.body||{},f)){updates.push(`\`${f}\`=?`);vals.push(serialize(cfg,f,req.body[f]));}updates.push('updated_date=?');vals.push(record.updated_date,rid);await pool.query(`UPDATE \`${table}\` SET ${updates.join(',')} WHERE id=?`,vals);const [r]=await pool.query(`SELECT * FROM \`${table}\` WHERE id=? LIMIT 1`,[rid]);return res.json(deserialize(cfg,r[0]));}
if(method==='DELETE'){if(!admin)return res.status(403).json({error:'Forbidden.'});const rid=String(req.query.id||'');if(!rid)return res.status(422).json({error:'Missing entity id.'});await pool.query(`DELETE FROM \`${table}\` WHERE id=?`,[rid]);return res.json({success:true,id:rid});}return res.status(405).json({error:'Method not allowed.'});}catch(e){next(e);}}
function cryptoRandom(n){return require('crypto').randomBytes(n).toString('hex').toUpperCase().slice(0,8);}
router.use(auth,enforceBookingNotice,bookingCreationLock,bookingAction,handler); module.exports=router;

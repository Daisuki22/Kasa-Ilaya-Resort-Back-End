const express=require('express'); const router=express.Router(); const {pool}=require('../config/database'); const {id,now,publicUser,isAdmin}=require('../utils'); const {auth}=require('../middleware/auth');
const {randomUUID,createHash}=require('node:crypto');
const {getPaymentProofUploadClaims}=require('../services/paymentProofUpload');
const {classifyPaymentProvider,createEmptyReceiptOcr,MIN_CONFIDENT_VERIFICATION}=require('../services/receiptOcr');
const fs=require('node:fs');
const path=require('node:path');
const {uploadsDir,bundledUploadsDir}=require('../config/uploads');
const {createNotification,notifySafely,notifyBookingAdmins}=require('../services/notifications');
const {quoteBooking}=require('../services/bookingPricing');
const {findExistingBookingSubmission}=require('../services/bookingSubmission');
const {validateRequiredBookingPayment}=require('../services/bookingPaymentValidation');
const {validateReceiptSignals}=require('../services/receiptValidation');
const {expirePastPendingBookings}=require('../services/bookingExpiration');
const {ACTIVE_BOOKING_STATUSES,addDateKeyDays,calendarDaysUntil,dateKeyFromDate,getBookingEndDateTime,getBookingStartDateTime,getTourTime,isBookingCancellationAllowed,isScheduleAvailable,isValidDateKey}=require('../services/bookingSchedule');
const BOOKING_SCHEDULE_LOCK='kasa_ilaya_booking_schedule';
const MAP={
 ActivityLog:{table:'activity_logs',fields:['id','created_date','updated_date','user_email','user_name','action','entity_type','entity_id','details']},
 Booking:{table:'bookings',fields:['id','created_date','updated_date','booking_reference','package_id','package_name','tour_type','booking_date','guest_count','customer_user_id','customer_name','customer_email','customer_phone','special_requests','total_amount','reservation_fee_amount','payment_type','payment_amount_due','payment_mode','payment_number','payment_reference_number','payment_qr_code_id','payment_qr_code_label','receipt_url','payment_proof_review','payment_proof_fingerprint','payment_proof_ocr_provider','payment_proof_ocr_amount','payment_proof_ocr_reference','payment_proof_ocr_date','payment_proof_ocr_confidence','terms_document_id','terms_version','terms_accepted','privacy_document_id','privacy_version','privacy_acknowledged','privacy_consent','legal_accepted_at','status','approved_by','approved_at','rejected_by','rejected_at','rejection_reason','payment_status','additional_fee_amount','additional_fee_reason','additional_fee_status','additional_fee_paid_at','additional_fee_paid_by','rebooking_status','rebooking_original_date','rebooking_requested_date','rebooking_reason','rebooking_requested_at','rebooking_resolved_at','rebooking_resolution_note','rebooking_count']},
 FoundItem:{table:'found_items',fields:['id','created_date','updated_date','item_name','description','date_found','location_found','found_by','status','image_url','claimed_guest_name','claimed_contact','claimed_reservation_id','proof_of_ownership','released_by','date_claimed','is_active']},
 LostItemReport:{table:'lost_item_reports',fields:['id','created_date','updated_date','guest_name','reservation_number','item_lost','description','date_lost','contact_number','email','status','matched_item_id']},
 Package:{table:'packages',fields:['id','created_date','updated_date','name','description','tour_type','price','day_tour_price','night_tour_price','twenty_two_hour_price','max_guests','inclusions','gallery_images','image_url','is_active'],json:['inclusions','gallery_images'],bool:['is_active'],numeric:['price','day_tour_price','night_tour_price','twenty_two_hour_price','max_guests']},
 PaymentQrCode:{table:'payment_qr_codes',fields:['id','created_date','updated_date','label','account_name','account_number','instructions','image_url','display_order','is_active'],bool:['is_active'],numeric:['display_order']},
 ResortRule:{table:'resort_rules',fields:['id','created_date','updated_date','title','description','sort_order','is_active'],bool:['is_active'],numeric:['sort_order']},
 SiteSetting:{table:'site_settings',fields:['id','created_date','updated_date','site_name','logo_url','hero_image_url','hero_images_json','packages_banner_url','packages_banner_images_json','hero_badge_text','hero_title_line1','hero_title_line2','hero_description','body_font_style','heading_font_style','amenities_section_label','amenities_section_title','amenities_section_description','resort_gallery_json','terms_title','terms_summary','terms_content','amenities_json','require_strong_password','min_password_length','session_timeout_minutes','max_login_attempts','lockout_minutes','enable_login_notifications'],bool:['require_strong_password','enable_login_notifications'],numeric:['min_password_length','session_timeout_minutes','max_login_attempts','lockout_minutes'],json:['hero_images_json','packages_banner_images_json','resort_gallery_json','amenities_json']},
 LegalDocument:{table:'legal_documents',fields:['id','created_date','updated_date','document_type','title','content','version','status','created_by','published_at']},
 User:{table:'users',fields:['id','created_date','updated_date','email','full_name','birth_date','phone','profile_image_url','role','disabled','is_verified','app_id','is_service','app_role'],bool:['disabled','is_verified','is_service']},
 UpcomingSchedule:{table:'upcoming_schedules',fields:['id','created_date','updated_date','title','schedule_date','start_time','end_time','location','description','created_by_name','created_by_email']},
 Review:{table:'reviews',fields:['id','created_date','updated_date','booking_id','booking_reference','guest_name','guest_email','package_name','rating','review_text','is_approved'],bool:['is_approved'],numeric:['rating']},
 Notification:{table:'notifications',fields:['id','created_date','user_email','event_key','title','description','link','entity_type','entity_id','is_read'],bool:['is_read']}
};
function deserialize(cfg,row){const out={...row};if(cfg.table==='bookings')delete out.payment_proof_fingerprint;for(const f of cfg.json||[]){if(out[f]!==null&&out[f]!==undefined){try{out[f]=typeof out[f]==='string'?JSON.parse(out[f]):out[f];}catch{out[f]=[];}}}for(const f of cfg.bool||[])if(f in out)out[f]=!!out[f];for(const f of cfg.numeric||[])if(out[f]!==null&&out[f]!==undefined){const n=Number(out[f]);out[f]=Number.isInteger(n)?n:n;}for(const f of ['created_date','updated_date'])if(out[f] instanceof Date)out[f]=out[f].toISOString();if(out.payment_proof_ocr_date instanceof Date)out.payment_proof_ocr_date=out.payment_proof_ocr_date.toISOString().slice(0,10);return out;}
function serialize(cfg,f,v){if((cfg.json||[]).includes(f))return v==null?null:JSON.stringify(v);if((cfg.bool||[]).includes(f))return v?1:0;return v;}
async function getScheduleRows(db,fromDate,toDate,forUpdate=false){const statusSlots=ACTIVE_BOOKING_STATUSES.map(()=>'?').join(',');const lock=forUpdate?' FOR UPDATE':'';const [bookings]=await db.query(`SELECT id,DATE_FORMAT(booking_date,'%Y-%m-%d') AS booking_date,tour_type,status FROM bookings WHERE status IN (${statusSlots}) AND booking_date BETWEEN ? AND ?${lock}`,[...ACTIVE_BOOKING_STATUSES,fromDate,toDate]);const [schedules]=await db.query(`SELECT DATE_FORMAT(schedule_date,'%Y-%m-%d') AS schedule_date FROM upcoming_schedules WHERE schedule_date BETWEEN ? AND ?${lock}`,[fromDate,toDate]);return {bookings,manualDates:schedules.map(row=>row.schedule_date)};}
async function databaseScheduleIsAvailable(db,bookingDate,tourType,excludeBookingId=null,forUpdate=false){const fromDate=addDateKeyDays(bookingDate,-1);const toDate=addDateKeyDays(bookingDate,tourType==='22_hours'?1:0);const {bookings,manualDates}=await getScheduleRows(db,fromDate,toDate,forUpdate);return isScheduleAvailable({bookingDate,tourType,bookings,manualDates,excludeBookingId});}
function httpError(message,status,appCode){return Object.assign(new Error(message),{status,...(appCode?{appCode}:{})});}
async function releaseNamedLock(connection){try{await connection.query('SELECT RELEASE_LOCK(?)',[BOOKING_SCHEDULE_LOCK]);}catch{}}
async function sendAvailability(req,res){const today=dateKeyFromDate(new Date());const excludeId=String(req.query.exclude_id||'');let verifiedExcludeId=null;if(excludeId&&req.user){const [owned]=await pool.query('SELECT id FROM bookings WHERE id=? AND LOWER(customer_email)=LOWER(?) LIMIT 1',[excludeId,req.user.email]);verifiedExcludeId=owned[0]?.id||null;}const excludeClause=verifiedExcludeId?' AND id<>?':'';const bookingParams=[...ACTIVE_BOOKING_STATUSES,today];if(verifiedExcludeId)bookingParams.push(verifiedExcludeId);const [bookings]=await pool.query(`SELECT DATE_FORMAT(booking_date,'%Y-%m-%d') AS booking_date,tour_type FROM bookings WHERE status IN (${ACTIVE_BOOKING_STATUSES.map(()=>'?').join(',')}) AND booking_date>=?${excludeClause}`,bookingParams);const [schedules]=await pool.query("SELECT DATE_FORMAT(schedule_date,'%Y-%m-%d') AS schedule_date FROM upcoming_schedules WHERE schedule_date>=?",[today]);return res.json({booking_dates:bookings,manual_schedule_dates:schedules.map(row=>row.schedule_date)});}
async function rescheduleBooking(req,res){
 if(!req.user)return res.status(401).json({error:'Not authenticated.'});
 const bookingId=String(req.query.id||'');
 if(!bookingId)return res.status(422).json({error:'Missing booking id.'});
 const body=req.body||{};
 if(Object.keys(body).some(key=>!['booking_date','note'].includes(key))||(body.booking_date!==undefined&&!isValidDateKey(body.booking_date)))return res.status(422).json({error:'A valid new booking date is required.'});
 const note=typeof body.note==='string'?body.note.trim().slice(0,500):'';
 const admin=isAdmin(req.user);
 if(!admin)return res.status(403).json({error:'Customer changes must be submitted as a reschedule request for resort review.'});
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
  const requestedDate=(booking.rebooking_status||'none')==='pending'?dateOnly(booking.rebooking_requested_date):body.booking_date;
  if(!isValidDateKey(requestedDate))throw httpError('The reschedule request does not contain a valid requested date.',422);
  if((booking.rebooking_status||'none')==='pending'&&body.booking_date&&requestedDate!==body.booking_date)throw httpError('The approval date does not match the requested reschedule date.',409);
  if(!['pending','confirmed'].includes(booking.status))throw httpError('Only an active reservation can be rescheduled.',409);
  if(!admin&&((booking.rebooking_status||'none')==='pending'||Number(booking.rebooking_count||0)>=1))throw httpError('This reservation is not eligible for another reschedule.',409);
  if(requestedDate===dateOnly(booking.booking_date))throw httpError('Choose a different date from the current reservation.',422);
  const today=dateKeyFromDate(new Date());
  if(requestedDate<=today)throw httpError('Choose a future date for your reservation.',422);
  const startTime=getBookingStartDateTime(requestedDate,booking.tour_type);
  if(!startTime||!getTourTime(booking.tour_type))throw httpError('This reservation has an invalid tour schedule.',422);
  if(!admin){
   const originalStart=getBookingStartDateTime(dateOnly(booking.booking_date),booking.tour_type);
   if(!originalStart)throw httpError('This reservation date cannot be checked.',422);
   const cutoff=originalStart.getTime()-7*24*60*60*1000;
   if(Date.now()>cutoff)throw httpError('Reschedule requests must be submitted at least 7 days before the reservation date.',409);
  }
  phase='validate_schedule_availability';
  const available=await databaseScheduleIsAvailable(connection,requestedDate,booking.tour_type,booking.id,true);
  if(!available)throw httpError('The selected schedule is unavailable. Please choose another date or time.',409,'BOOKING_SCHEDULE_UNAVAILABLE');
  const originalDate=dateOnly(booking.booking_date);
  const resolutionNote=note||(admin?'Rescheduled by resort administrator.':'Rescheduled by guest.');
  phase='update_booking';
  await connection.query("UPDATE bookings SET booking_date=?,rebooking_status='approved',rebooking_original_date=?,rebooking_requested_date=?,rebooking_requested_at=NOW(),rebooking_resolved_at=NOW(),rebooking_resolution_note=?,rebooking_count=COALESCE(rebooking_count,0)+1,updated_date=NOW() WHERE id=?",[requestedDate,originalDate,requestedDate,resolutionNote,booking.id]);
  const oldTime=getTourTime(booking.tour_type);
  const newTime=getTourTime(booking.tour_type);
  const details=`${admin?'Admin':'Customer'} rescheduled ${booking.booking_reference} (booking ${booking.id}) from ${originalDate} ${oldTime.label} to ${requestedDate} ${newTime.label}. Package: ${booking.package_name}. Guests: ${booking.guest_count}. Payment status preserved: ${booking.payment_status}.`;
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
  if(status>=500&&status!==503){
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
async function requestReschedule(req,res){
 if(!req.user)return res.status(401).json({error:'Not authenticated.'});
 const bookingId=String(req.query.id||'');
 const body=req.body||{};
 if(!bookingId)return res.status(422).json({error:'Missing booking id.'});
 if(Object.keys(body).some(key=>!['booking_date','note'].includes(key))||!isValidDateKey(body.booking_date))return res.status(422).json({error:'A valid requested booking date is required.'});
 const note=typeof body.note==='string'?body.note.trim().slice(0,500):'';
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
  if(String(booking.customer_email||'').toLowerCase()!==String(req.user.email||'').toLowerCase())throw httpError('You are not authorized to request a schedule change.',403);
  if(!['pending','confirmed'].includes(booking.status))throw httpError('Only an active reservation can request rescheduling.',409);
  if((booking.rebooking_status||'none')==='pending'){
   if(dateOnly(booking.rebooking_requested_date)===body.booking_date){
    await connection.commit();
    transactionStarted=false;
    return res.json({success:true,data:deserialize(MAP.Booking,booking),already_requested:true});
   }
   throw httpError('A reschedule request is already awaiting resort review.',409);
  }
  if(Number(booking.rebooking_count||0)>=1)throw httpError('This reservation has already been rescheduled.',409);
  const originalDate=dateOnly(booking.booking_date);
  if(body.booking_date===originalDate)throw httpError('Choose a different date from the current reservation.',422);
  if(body.booking_date<=dateKeyFromDate(new Date()))throw httpError('Choose a future date for your reservation.',422);
  if(!getBookingStartDateTime(body.booking_date,booking.tour_type)||!getTourTime(booking.tour_type))throw httpError('This reservation has an invalid tour schedule.',422);
  phase='validate_schedule_availability';
  if(!await databaseScheduleIsAvailable(connection,body.booking_date,booking.tour_type,booking.id,true))throw httpError('The selected schedule is unavailable. Please choose another date or time.',409,'BOOKING_SCHEDULE_UNAVAILABLE');
  phase='save_request';
  await connection.query("UPDATE bookings SET rebooking_status='pending',rebooking_original_date=?,rebooking_requested_date=?,rebooking_reason=?,rebooking_requested_at=NOW(),rebooking_resolved_at=NULL,rebooking_resolution_note=NULL,updated_date=NOW() WHERE id=?",[originalDate,body.booking_date,note||null,booking.id]);
  const [updatedRows]=await connection.query('SELECT * FROM bookings WHERE id=? LIMIT 1',[booking.id]);
  phase='commit_transaction';
  await connection.commit();
  transactionStarted=false;
  await notifySafely({email:booking.customer_email,eventKey:`booking:${booking.id}:reschedule-requested:${body.booking_date}`,title:'Your reschedule request was submitted',description:`Your request to change the booking date from ${originalDate} to ${body.booking_date} is awaiting resort review.`,link:'/MyBookings',entityId:booking.id});
  return res.json({success:true,data:deserialize(MAP.Booking,updatedRows[0])});
 }catch(error){
  if(transactionStarted)try{await connection.rollback();}catch{}
  const status=error.status||500;
  if(status>=500){
   const requestId=randomUUID();
   console.error('Reschedule request failed',{requestId,phase,code:error.code,errno:error.errno,sqlState:error.sqlState});
   return res.status(status).json({error:status===500?'Unable to submit the reschedule request. Your existing reservation was not changed.':error.message,request_id:requestId});
  }
  return res.status(status).json({error:error.message});
 }finally{
  if(connection){if(lockAcquired)await releaseNamedLock(connection);connection.release();}
 }
}
async function cancelBooking(req,res){
 if(!req.user)return res.status(401).json({error:'Not authenticated.'});
 const bookingId=String(req.query.id||'');
 if(!bookingId)return res.status(422).json({error:'Missing booking id.'});
 const action=String(req.query.action||'');
 if(Object.keys(req.body||{}).some(key=>key!=='status')||(req.body?.status!==undefined&&req.body.status!=='cancelled')||(action!=='cancel'&&req.body?.status!=='cancelled'))return res.status(422).json({error:'Invalid cancellation request.'});
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
  const [rows]=await connection.query("SELECT *,DATE_FORMAT(booking_date,'%Y-%m-%d') AS booking_date_key FROM bookings WHERE id=? FOR UPDATE",[bookingId]);
  const booking=rows[0];
  if(!booking)throw httpError('Reservation not found.',404);
  const ownsById=booking.customer_user_id&&String(booking.customer_user_id)===String(req.user.id);
  const ownsByEmail=String(booking.customer_email||'').toLowerCase()===String(req.user.email||'').toLowerCase();
  if(admin||(!ownsById&&!ownsByEmail))throw httpError('Only the customer who owns this reservation can cancel it.',403);
  if(!['pending','confirmed'].includes(booking.status))throw httpError('Only active pending or confirmed reservations can be cancelled.',409);
  const bookingDate=String(booking.booking_date_key||'').slice(0,10);
  if(!isValidDateKey(bookingDate))throw httpError('This booking date cannot be checked for cancellation.',422);
  const daysUntil=calendarDaysUntil(bookingDate);
  if(!isBookingCancellationAllowed(booking,bookingDate)){
   const message=daysUntil<=0
    ?'Reservations on today or past dates cannot be cancelled online.'
    :'Online cancellation is no longer available within 7 days of your reservation date. You may request a reschedule.';
   const error=httpError(message,400);
   error.code='CANCELLATION_NOT_ALLOWED';
   error.days_until_booking=daysUntil;
   throw error;
  }
  phase='cancel_booking';
  const [result]=await connection.query("UPDATE bookings SET status='cancelled',updated_date=? WHERE id=? AND status IN ('pending','confirmed')",[now(),bookingId]);
  if(!result.affectedRows)throw httpError('This reservation has already changed and cannot be cancelled.',409);
  phase='write_activity_log';
  const paymentNote=booking.payment_status==='paid'?' Payment status remains paid; no refund was issued and the payment record and proof were retained.':` Payment status remains ${booking.payment_status||'unpaid'}.`;
  await connection.query('INSERT INTO activity_logs (id,created_date,updated_date,user_email,user_name,action,entity_type,entity_id,details) VALUES (?,?,?,?,?,?,?,?,?)',[id('activitylog'),now(),now(),req.user.email||null,req.user.full_name||req.user.name||'Guest',admin?'Admin Cancelled Booking':'Customer Cancelled Booking','Booking',bookingId,`Cancelled reservation ${booking.booking_reference||bookingId} scheduled for ${bookingDate}.${paymentNote}`]);
  phase='reload_booking';
  const [updatedRows]=await connection.query('SELECT * FROM bookings WHERE id=? LIMIT 1',[bookingId]);
  if(!updatedRows[0])throw new Error('Cancelled reservation could not be reloaded.');
  await connection.commit();
  transactionStarted=false;
  return res.json({success:true,data:deserialize(MAP.Booking,updatedRows[0])});
 }catch(error){
  if(transactionStarted)try{await connection.rollback();}catch{}
  const status=error.status||500;
  if(status>=500&&status!==503){
   const requestId=randomUUID();
   console.error('Reservation cancellation failed',{requestId,phase,code:error.code,errno:error.errno,sqlState:error.sqlState});
   return res.status(500).json({error:'Unable to cancel this reservation right now.',request_id:requestId});
  }
  return res.status(status).json({success:false,error:error.code||'CANCELLATION_FAILED',message:error.message});
 }finally{if(connection){if(lockAcquired)await releaseNamedLock(connection);connection.release();}}
}
async function rejectRescheduleRequest(req,res){
 if(!isAdmin(req.user))return res.status(403).json({error:'Only resort administrators can resolve reschedule requests.'});
 const bookingId=String(req.query.id||'');
 const body=req.body||{};
 if(!bookingId)return res.status(422).json({error:'Missing booking id.'});
 if(Object.keys(body).some(key=>!['note'].includes(key)))return res.status(422).json({error:'Invalid reschedule decision.'});
 const note=typeof body.note==='string'?body.note.trim().slice(0,500):'';
 let connection;
 let transactionStarted=false;
 try{
  connection=await pool.getConnection();
  await connection.beginTransaction();
  transactionStarted=true;
  const [rows]=await connection.query('SELECT * FROM bookings WHERE id=? FOR UPDATE',[bookingId]);
  const booking=rows[0];
  if(!booking)throw httpError('Reservation not found.',404);
  if((booking.rebooking_status||'none')!=='pending')throw httpError('This reservation has no pending reschedule request.',409);
  const requestedDate=dateOnly(booking.rebooking_requested_date);
  const resolutionNote=note||'Reschedule request declined by resort administrator.';
  await connection.query("UPDATE bookings SET rebooking_status='declined',rebooking_resolved_at=NOW(),rebooking_resolution_note=?,updated_date=NOW() WHERE id=?",[resolutionNote,booking.id]);
  const [updatedRows]=await connection.query('SELECT * FROM bookings WHERE id=? LIMIT 1',[booking.id]);
  await connection.commit();
  transactionStarted=false;
  await notifySafely({email:booking.customer_email,eventKey:`booking:${booking.id}:reschedule-declined:${requestedDate}`,title:'Your reschedule request was declined',description:`Your original booking date remains ${dateOnly(booking.booking_date)}.${note?` Resort note: ${note}`:''}`,link:'/MyBookings',entityId:booking.id});
  return res.json({success:true,data:deserialize(MAP.Booking,updatedRows[0])});
 }catch(error){
  if(transactionStarted)try{await connection.rollback();}catch{}
  const status=error.status||500;
  if(status>=500){const requestId=randomUUID();console.error('Reschedule rejection failed',{requestId,code:error.code,errno:error.errno,sqlState:error.sqlState});return res.status(status).json({error:'Unable to decline the reschedule request.',request_id:requestId});}
  return res.status(status).json({error:error.message});
 }finally{if(connection)connection.release();}
}
async function publishLegalDocument(req,res){
 if(!isAdmin(req.user))return res.status(403).json({error:'Only resort administrators can publish legal documents.'});
 const documentId=String(req.query.id||'');
 if(!documentId)return res.status(422).json({error:'Missing legal document id.'});
 let connection;
 let lockAcquired=false;
 let transactionStarted=false;
 try{
  connection=await pool.getConnection();
  const [lockRows]=await connection.query("SELECT GET_LOCK('kasa_ilaya_legal_documents',10) AS acquired");
  lockAcquired=Number(lockRows[0]?.acquired)===1;
  if(!lockAcquired)throw httpError('Legal documents are being updated. Please try again.',503);
  await connection.beginTransaction();
  transactionStarted=true;
  const [rows]=await connection.query('SELECT * FROM legal_documents WHERE id=? FOR UPDATE',[documentId]);
  const document=rows[0];
  if(!document)throw httpError('Legal document draft not found.',404);
  if(document.status!=='draft')throw httpError('Only a saved draft can be published.',409);
  await connection.query("UPDATE legal_documents SET status='archived',updated_date=NOW() WHERE document_type=? AND status='published'",[document.document_type]);
  await connection.query("UPDATE legal_documents SET status='published',published_at=NOW(),updated_date=NOW() WHERE id=? AND status='draft'",[document.id]);
  const [publishedRows]=await connection.query('SELECT * FROM legal_documents WHERE id=? LIMIT 1',[document.id]);
  await connection.commit();
  transactionStarted=false;
  return res.json({success:true,data:publishedRows[0]});
 }catch(error){
  if(transactionStarted)try{await connection.rollback();}catch{}
  const status=error.status||500;
  if(status>=500){
   const requestId=randomUUID();
   console.error('Legal document publish failed',{requestId,code:error.code,errno:error.errno,sqlState:error.sqlState});
   return res.status(status).json({error:'Unable to publish this legal document.',request_id:requestId});
  }
  return res.status(status).json({error:error.message});
 }finally{
  if(connection){if(lockAcquired)try{await connection.query("SELECT RELEASE_LOCK('kasa_ilaya_legal_documents')");}catch{}connection.release();}
 }
}
async function updateLegalDocumentDraft(req,res,next){
 if(!isAdmin(req.user))return res.status(403).json({error:'Only resort administrators can edit legal documents.'});
 const documentId=String(req.query.id||'');
 if(!documentId)return res.status(422).json({error:'Missing legal document id.'});
 const patch=req.body||{};
 if(Object.keys(patch).some((key)=>!['title','content','version'].includes(key)))return res.status(403).json({error:'Only a draft title, content, or version can be edited.'});
 let connection;
 let transactionStarted=false;
 try{
  connection=await pool.getConnection();
  await connection.beginTransaction();
  transactionStarted=true;
  const [rows]=await connection.query('SELECT * FROM legal_documents WHERE id=? FOR UPDATE',[documentId]);
  if(!rows[0])throw httpError('Legal document not found.',404);
  if(rows[0].status!=='draft')throw httpError('Published legal documents are immutable. Save a new draft to make changes.',409);
  const record={...rows[0],...patch,updated_date:now()};
  await validate('LegalDocument',record,documentId,connection);
  const fields=['title','content','version'].filter((field)=>Object.prototype.hasOwnProperty.call(patch,field));
  if(fields.length){
   const updates=fields.map((field)=>`\`${field}\`=?`);
   const values=fields.map((field)=>record[field]);
   updates.push('updated_date=?');
   values.push(record.updated_date,documentId);
   await connection.query(`UPDATE legal_documents SET ${updates.join(',')} WHERE id=? AND status='draft'`,values);
  }
  const [updatedRows]=await connection.query('SELECT * FROM legal_documents WHERE id=? LIMIT 1',[documentId]);
  await connection.commit();
  transactionStarted=false;
  return res.json(updatedRows[0]);
 }catch(error){
  if(transactionStarted)try{await connection.rollback();}catch{}
  if((error.status||500)>=500)return next(error);
  return res.status(error.status).json({error:error.message});
 }finally{if(connection)connection.release();}
}
async function legalDocumentAction(req,res,next){
 if(String(req.query.entity||'')!=='LegalDocument')return next();
 const admin=isAdmin(req.user);
 if(req.method==='PATCH'&&String(req.query.action||'')==='publish')return publishLegalDocument(req,res);
 if(['PATCH','PUT'].includes(req.method))return updateLegalDocumentDraft(req,res,next);
 if(req.method==='GET'){
  if(admin)return next();
  try{
   const [rows]=await pool.query("SELECT id,created_date,updated_date,document_type,title,content,version,status,created_by,published_at FROM legal_documents WHERE status='published' ORDER BY document_type ASC");
   return res.json(rows);
  }catch(error){return next(error);}
 }
 if(!admin)return res.status(403).json({error:'Only resort administrators can edit legal documents.'});
 if(req.method==='DELETE')return res.status(405).json({error:'Legal document history is retained; drafts can be replaced by saving another draft.'});
 if(req.method==='POST'){
  req.body={...(req.body||{}),status:'draft',published_at:null,created_by:req.user.id};
  return next();
 }
 return next();
}
async function acceptBooking(req,res){
 if(!isAdmin(req.user))return res.status(403).json({error:'Only resort administrators can accept bookings.'});
 const bookingId=String(req.query.id||'');
 if(!bookingId)return res.status(422).json({error:'Missing booking id.'});
 let connection;
 let transactionStarted=false;
 try{
  await expirePastPendingBookings();
  connection=await pool.getConnection();
  await connection.beginTransaction();
  transactionStarted=true;
   const [rows]=await connection.query("SELECT *,DATE_FORMAT(payment_proof_ocr_date,'%Y-%m-%d') AS receipt_date_key FROM bookings WHERE id=? FOR UPDATE",[bookingId]);
   const booking=rows[0];
   if(!booking)throw httpError('Reservation not found.',404);
   if(booking.status!=='pending')throw httpError('Only pending bookings can be accepted.',409);
   const receiptPath=uploadedReceiptPath(booking.receipt_url);
   if(!receiptPath)throw httpError('A valid payment receipt is required before accepting this booking.',422);
   const receiptDate=String(booking.receipt_date_key||'').slice(0,10);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(receiptDate)){
    throw httpError('The receipt date could not be verified. Keep this booking pending for manual review.',422);
   }
   const latestAllowedDate=dateKeyFromDate(new Date());
   const outdatedReason=`Receipt is outdated. The uploaded receipt date is ${receiptDate}, but the latest allowed receipt date is ${latestAllowedDate}.`;
   const declineAndReturn=async(reason)=>{
    await connection.query("UPDATE bookings SET status='rejected',payment_status='declined',payment_proof_review='auto_declined',rejected_at=COALESCE(rejected_at,NOW()),rejection_reason=?,updated_date=NOW() WHERE id=? AND status='pending'",[reason,booking.id]);
    const [declinedRows]=await connection.query('SELECT * FROM bookings WHERE id=? LIMIT 1',[booking.id]);
    await connection.commit();
    transactionStarted=false;
    return res.status(400).json({success:false,status:'DECLINED',reason,data:declinedRows[0]?deserialize(MAP.Booking,declinedRows[0]):undefined});
   };
   if(receiptDate<latestAllowedDate)return await declineAndReturn(outdatedReason);
   if(booking.payment_status!=='pending_verification'||!String(booking.payment_mode||booking.payment_qr_code_label||'').trim()||!Number.isFinite(Number(booking.payment_amount_due))||Number(booking.payment_amount_due)<=0){
    return await declineAndReturn('Unable to verify receipt information.');
   }
   const [qrRows]=await connection.query('SELECT id,label FROM payment_qr_codes WHERE id=? LIMIT 1',[booking.payment_qr_code_id]);
   if(!qrRows[0])return await declineAndReturn('Payment method does not match selected payment method.');
   const receiptAmount=Number(booking.payment_proof_ocr_amount);
   if(!Number.isFinite(receiptAmount)||Math.abs(receiptAmount-Number(booking.payment_amount_due))>0.01){
    return await declineAndReturn('Payment amount does not match required amount.');
   }
   const detectedProvider=classifyPaymentProvider(booking.payment_proof_ocr_provider);
   const selectedProvider=classifyPaymentProvider(qrRows[0].label);
   if(detectedProvider&&selectedProvider&&detectedProvider!==selectedProvider){
    return await declineAndReturn('Payment method does not match selected payment method.');
   }
   try{validateRequiredBookingPayment(booking);}catch{return await declineAndReturn('Invalid payment/reference information.');}
   if(booking.payment_proof_ocr_reference&&String(booking.payment_reference_number||'').trim().toLowerCase()!==String(booking.payment_proof_ocr_reference).trim().toLowerCase()){
    return await declineAndReturn('Invalid payment/reference information.');
   }
  await connection.query("UPDATE bookings SET status='confirmed',approved_by=?,approved_at=NOW(),payment_status='paid',updated_date=NOW() WHERE id=? AND status='pending'",[String(req.user.id||'').slice(0,64),booking.id]);
  await connection.query('INSERT INTO activity_logs (id,created_date,updated_date,user_email,user_name,action,entity_type,entity_id,details) VALUES (?,?,?,?,?,?,?,?,?)',[id('activitylog'),now(),now(),req.user.email||null,req.user.full_name||req.user.name||'Administrator','Booking accepted and payment verified','Booking',booking.id,`Accepted ${booking.booking_reference} and verified the submitted ${booking.payment_mode||booking.payment_qr_code_label} proof for ${Number(booking.payment_amount_due).toFixed(2)}.`]);
  const [updatedRows]=await connection.query('SELECT * FROM bookings WHERE id=? LIMIT 1',[booking.id]);
  await connection.commit();
  transactionStarted=false;
  return res.json({success:true,data:deserialize(MAP.Booking,updatedRows[0])});
 }catch(error){
  if(transactionStarted)try{await connection.rollback();}catch{}
  const status=error.status||500;
  if(status>=500){
   const requestId=randomUUID();
   console.error('Booking acceptance failed',{requestId,code:error.code,errno:error.errno,sqlState:error.sqlState,...(process.env.NODE_ENV==='production'?{}:{details:String(error.message||'').slice(0,500)})});
   return res.status(status).json({error:'Unable to accept this booking. No booking or payment status was changed.',error_code:process.env.NODE_ENV==='production'?'INTERNAL_SERVER_ERROR':(error.code||'INTERNAL_SERVER_ERROR'),...(process.env.NODE_ENV==='production'?{}:{details:String(error.message||'').slice(0,500)}),request_id:requestId});
  }
  return res.status(status).json({error:error.message});
 }finally{if(connection)connection.release();}
}
async function rejectBooking(req,res){
 if(!isAdmin(req.user))return res.status(403).json({error:'Only resort administrators can reject bookings.'});
 const bookingId=String(req.query.id||'');
 const reason=typeof req.body?.reason==='string'?req.body.reason.trim():'';
 if(!bookingId)return res.status(422).json({error:'Missing booking id.'});
 if(reason.length<5||reason.length>1000)return res.status(422).json({error:'Enter a rejection reason between 5 and 1,000 characters.'});
 let connection;
 let transactionStarted=false;
 try{
  connection=await pool.getConnection();
  await connection.beginTransaction();
  transactionStarted=true;
  const [rows]=await connection.query('SELECT * FROM bookings WHERE id=? FOR UPDATE',[bookingId]);
  const booking=rows[0];
  if(!booking)throw httpError('Reservation not found.',404);
  if(booking.status!=='pending')throw httpError('Only pending bookings can be rejected.',409);
  await connection.query("UPDATE bookings SET status='rejected',rejected_by=?,rejected_at=NOW(),rejection_reason=?,updated_date=NOW() WHERE id=? AND status='pending'",[String(req.user.id||'').slice(0,64),reason.slice(0,1000),booking.id]);
  await connection.query('INSERT INTO activity_logs (id,created_date,updated_date,user_email,user_name,action,entity_type,entity_id,details) VALUES (?,?,?,?,?,?,?,?,?)',[id('activitylog'),now(),now(),req.user.email||null,req.user.full_name||req.user.name||'Administrator','Booking rejected','Booking',booking.id,`Rejected ${booking.booking_reference||booking.id}. Reason: ${reason.slice(0,800)}`]);
  const [updatedRows]=await connection.query('SELECT * FROM bookings WHERE id=? LIMIT 1',[booking.id]);
  await connection.commit();
  transactionStarted=false;
  return res.json({success:true,data:deserialize(MAP.Booking,updatedRows[0])});
 }catch(error){
  if(transactionStarted)try{await connection.rollback();}catch{}
  const status=error.status||500;
  if(status>=500){const requestId=randomUUID();console.error('Booking rejection failed',{requestId,code:error.code,errno:error.errno,sqlState:error.sqlState});return res.status(status).json({error:'Unable to reject this booking right now.',request_id:requestId});}
  return res.status(status).json({error:error.message});
 }finally{if(connection)connection.release();}
}
async function markAdditionalFeePaid(req,res){
 if(!isAdmin(req.user))return res.status(403).json({error:'Only resort administrators can record a damage fee payment.'});
 const bookingId=String(req.query.id||'');
 if(!bookingId)return res.status(422).json({error:'Missing booking id.'});
 let connection;
 let transactionStarted=false;
 try{
  connection=await pool.getConnection();
  await connection.beginTransaction();
  transactionStarted=true;
  const [rows]=await connection.query('SELECT id,booking_reference,customer_name,customer_email,additional_fee_amount,additional_fee_status FROM bookings WHERE id=? FOR UPDATE',[bookingId]);
  const booking=rows[0];
  if(!booking)throw httpError('Booking not found.',404);
  if(Number(booking.additional_fee_amount||0)<=0||booking.additional_fee_status==='pending')throw httpError('A billed damage fee is required before recording payment.',409);
  if(booking.additional_fee_status==='paid')throw httpError('This damage fee has already been marked paid.',409);
  const paidBy=req.user.full_name||req.user.name||'Administrator';
  const amount=Number(booking.additional_fee_amount).toFixed(2);
  await connection.query("UPDATE bookings SET additional_fee_status='paid',additional_fee_paid_at=NOW(),additional_fee_paid_by=?,updated_date=NOW() WHERE id=? AND additional_fee_status='unpaid'",[paidBy.slice(0,64),bookingId]);
  await connection.query('INSERT INTO activity_logs (id,created_date,updated_date,user_email,user_name,action,entity_type,entity_id,details) VALUES (?,?,?,?,?,?,?,?,?)',[id('activitylog'),now(),now(),req.user.email||null,paidBy,'Damage Fee Marked Paid','Booking',booking.id,`Recorded damage fee payment for ${booking.booking_reference||booking.id}. Guest: ${booking.customer_name||booking.customer_email||'Unknown'}. Amount: ${amount}. Paid by: ${paidBy}.`]);
  const [updatedRows]=await connection.query('SELECT * FROM bookings WHERE id=? LIMIT 1',[bookingId]);
  await connection.commit();
  transactionStarted=false;
  return res.json({success:true,data:deserialize(MAP.Booking,updatedRows[0])});
 }catch(error){
  if(transactionStarted)try{await connection.rollback();}catch{}
  const status=error.status||500;
  if(status>=500)return next(error);
  return res.status(status).json({error:error.message});
 }finally{if(connection)connection.release();}
}
async function createBooking(req,res,next){
 if(!req.user)return res.status(401).json({error:'Not authenticated.',request_id:req.requestId});
 const payload=req.body||{};
 const bookingLogContext={userId:String(req.user.id||'').slice(0,64),packageId:typeof payload.package_id==='string'?payload.package_id.slice(0,64):null,bookingReference:typeof payload.booking_reference==='string'?payload.booking_reference.slice(0,64):null};
 console.info('Booking request received',{
  requestId:req.requestId,
  method:req.method,
  path:req.path,
  payloadKeys:Object.keys(payload).slice(0,50).map((key)=>String(key).slice(0,64)),
  packageId:typeof payload.package_id==='string'?payload.package_id.slice(0,64):null,
  bookingDate:typeof payload.booking_date==='string'?payload.booking_date.slice(0,10):null,
  tourType:typeof payload.tour_type==='string'?payload.tour_type.slice(0,32):null,
  guestCount:Number.isFinite(Number(payload.guest_count))?Number(payload.guest_count):null,
  totalAmount:Number.isFinite(Number(payload.total_amount))?Number(payload.total_amount):null,
  paymentType:typeof payload.payment_type==='string'?payload.payment_type.slice(0,32):null,
  paymentQrCodeId:typeof payload.payment_qr_code_id==='string'?payload.payment_qr_code_id.slice(0,64):null,
  receiptProvided:Boolean(payload.receipt_url),
  termsVersion:typeof payload.terms_version==='string'?payload.terms_version.slice(0,32):null,
  termsAccepted:payload.terms_accepted===true,
  privacyVersion:typeof payload.privacy_version==='string'?payload.privacy_version.slice(0,32):null,
  privacyAcknowledged:payload.privacy_acknowledged===true,
  privacyConsent:payload.privacy_consent===true,
 });
 let connection;
 let transactionStarted=false;
 let stage='acquire_connection';
 try{
  connection=await pool.getConnection();
  stage='begin_transaction';
  await connection.beginTransaction();
  transactionStarted=true;
  const cfg=MAP.Booking;
  const record={};
  for(const field of cfg.fields)if(Object.prototype.hasOwnProperty.call(payload,field))record[field]=payload[field];
  const submittedReference=String(payload.booking_reference||'').trim().slice(0,64);
  if(submittedReference){
   stage='check_duplicate_submission';
   const existingBooking=await findExistingBookingSubmission(connection,submittedReference,req.user);
   if(existingBooking){
    await connection.commit();
    transactionStarted=false;
    console.info('Duplicate booking submission returned existing reservation',{requestId:req.requestId,bookingId:existingBooking.id,bookingReference:submittedReference});
    return res.status(200).json(deserialize(cfg,existingBooking));
   }
  }
  record.id=record.id||id('booking');
  record.created_date=now();
  record.updated_date=record.created_date;
  record.customer_email=req.user.email;
  record.customer_user_id=req.user.id;
  record.booking_reference=record.booking_reference||`KI-${cryptoRandom(4)}`;
  bookingLogContext.bookingReference=String(record.booking_reference).slice(0,64);
  record.status='pending';
  record.payment_status=record.receipt_url?'pending_verification':'unpaid';
  record.payment_proof_review=record.receipt_url?'needs_manual_review':null;
  record.payment_proof_fingerprint=null;
  if(record.receipt_url){
   const proofPath=uploadedReceiptPath(record.receipt_url);
   if(proofPath){
    record.payment_proof_fingerprint=createHash('sha256').update(fs.readFileSync(proofPath)).digest('hex');
    stage='check_duplicate_payment_proof';
    const [duplicates]=await connection.query('SELECT id FROM bookings WHERE payment_proof_fingerprint=? LIMIT 1',[record.payment_proof_fingerprint]);
    if(duplicates.length)record.payment_proof_review='duplicate_needs_review';
   }
  }
  stage='validate_booking_and_availability';
  await validate('Booking',record,null,connection);
  stage='validate_payment_proof';
  await validateBookingSubmission(record,connection,payload.payment_proof_token,req.user.id);
  stage='check_payment_reference_number';
   stage='validate_legal_acceptance';
  await validateBookingLegalAcceptance(record,payload,connection);
  const cols=[];
  const placeholders=[];
  const values=[];
  for(const field of cfg.fields){
   if(!Object.prototype.hasOwnProperty.call(record,field))continue;
   cols.push(`\`${field}\``);
   placeholders.push('?');
   values.push(serialize(cfg,field,record[field]));
  }
  stage='insert_booking';
  await connection.query(`INSERT INTO \`bookings\` (${cols.join(',')}) VALUES (${placeholders.join(',')})`,values);
  stage='read_created_booking';
  const [rows]=await connection.query('SELECT * FROM bookings WHERE id=? LIMIT 1',[record.id]);
  stage='commit_transaction';
  await connection.commit();
  transactionStarted=false;
  return res.status(201).json(deserialize(cfg,rows[0]||record));
 }catch(error){
  error.bookingStage=stage;
  error.bookingContext=bookingLogContext;
  if(transactionStarted)try{await connection.rollback();}catch{}
  return next(error);
 }finally{if(connection)connection.release();}
}
async function declineOutdatedPendingReceipts(db=pool){
 const latestAllowedDate=dateKeyFromDate(new Date());
 await db.query("UPDATE bookings SET status='rejected',payment_status='declined',payment_proof_review='auto_declined',rejected_at=COALESCE(rejected_at,NOW()),rejection_reason=CONCAT('Receipt is outdated. The uploaded receipt date is ',DATE_FORMAT(payment_proof_ocr_date,'%Y-%m-%d'),', but the latest allowed receipt date is ',? ,'.'),updated_date=NOW() WHERE status='pending' AND payment_status='pending_verification' AND payment_proof_ocr_date IS NOT NULL AND payment_proof_ocr_date<?",[latestAllowedDate,latestAllowedDate]);
}
async function adminBookingPage(req,res,next){
 if(!req.user)return res.status(401).json({error:'Not authenticated.'});
 if(!isAdmin(req.user))return res.status(403).json({error:'Forbidden.'});
  try{
   await expirePastPendingBookings();
   await declineOutdatedPendingReceipts();
  const pageText=String(req.query.page||'1');
  const limitText=String(req.query.limit||'10');
  const requestedPage=Number(pageText);
  const pageSize=Number(limitText);
  if(!/^\d+$/.test(pageText)||!/^\d+$/.test(limitText)||!Number.isSafeInteger(requestedPage)||requestedPage<1||![10,25,50].includes(pageSize))return res.status(422).json({error:'Choose a valid page and page size.'});
  const where=[];
  const values=[];
  const search=String(req.query.search||'').trim().slice(0,120);
  const status=String(req.query.status||'').trim();
  const paymentStatus=String(req.query.payment_status||'').trim();
  const dateFrom=String(req.query.date_from||'').trim();
  const dateTo=String(req.query.date_to||'').trim();
  const packageId=String(req.query.package_id||'').trim().slice(0,64);
  if(search){where.push('(booking_reference LIKE ? OR customer_name LIKE ? OR customer_email LIKE ? OR package_name LIKE ?)');const term=`%${search}%`;values.push(term,term,term,term);}
  if(status){if(!['pending','confirmed','cancelled','completed','archived','rejected'].includes(status))return res.status(422).json({error:'Choose a valid reservation status.'});where.push('status=?');values.push(status);}
  if(paymentStatus){if(!['unpaid','pending_verification','paid'].includes(paymentStatus))return res.status(422).json({error:'Choose a valid payment status.'});where.push('payment_status=?');values.push(paymentStatus);}
  if(dateFrom){if(!isValidDateKey(dateFrom))return res.status(422).json({error:'Choose a valid start date.'});where.push('booking_date>=?');values.push(dateFrom);}
  if(dateTo){if(!isValidDateKey(dateTo))return res.status(422).json({error:'Choose a valid end date.'});where.push('booking_date<=?');values.push(dateTo);}
  if(dateFrom&&dateTo&&dateFrom>dateTo)return res.status(422).json({error:'Start date must be on or before end date.'});
  if(packageId){where.push('package_id=?');values.push(packageId);}
  const whereSql=where.length?` WHERE ${where.join(' AND ')}`:'';
  const [countRows]=await pool.query(`SELECT COUNT(*) AS total FROM bookings${whereSql}`,values);
  const total=Number(countRows[0]?.total||0);
  const totalPages=Math.max(1,Math.ceil(total/pageSize));
  const page=Math.min(requestedPage,totalPages);
  const sortField=String(req.query.sort||'-created_date');
  const sortFields={created_date:'created_date',booking_date:'booking_date',customer_name:'customer_name',package_name:'package_name',total_amount:'total_amount',status:'status',payment_status:'payment_status'};
  const descending=sortField.startsWith('-');
  const requestedSort=descending?sortField.slice(1):sortField;
  const orderColumn=sortFields[requestedSort]||'created_date';
  const direction=descending?'DESC':'ASC';
  const offset=(page-1)*pageSize;
  const [rows]=await pool.query(`SELECT * FROM bookings${whereSql} ORDER BY \`${orderColumn}\` ${direction},created_date DESC LIMIT ? OFFSET ?`,[...values,pageSize,offset]);
  return res.json({success:true,data:rows.map((row)=>deserialize(MAP.Booking,row)),pagination:{page,limit:pageSize,total,totalPages}});
 }catch(error){return next(error);}
}
async function bookingAction(req,res,next){
 try{
  const entity=String(req.query.entity||'');
  const action=String(req.query.action||'');
  if(entity!=='Booking')return next();
  if(req.method==='POST')return createBooking(req,res,next);
  if(req.method==='GET'&&action==='admin-page')return adminBookingPage(req,res,next);
  if(['PATCH','PUT'].includes(req.method)&&(action==='cancel'||req.body?.status==='cancelled'))return cancelBooking(req,res);
  if(req.method==='GET'&&action==='availability')return sendAvailability(req,res);
  if(req.method==='PATCH'&&action==='accept')return acceptBooking(req,res);
  if(req.method==='PATCH'&&action==='reject')return rejectBooking(req,res);
  if(req.method==='PATCH'&&action==='mark-additional-fee-paid')return markAdditionalFeePaid(req,res);
  if(req.method==='PATCH'&&action==='request-reschedule')return requestReschedule(req,res);
  if(req.method==='PATCH'&&action==='resolve-reschedule')return rejectRescheduleRequest(req,res);
  if(req.method==='PATCH'&&action==='reschedule')return rescheduleBooking(req,res);
  if(['PATCH','PUT'].includes(req.method)&&Object.keys(req.body||{}).some((key)=>['terms_document_id','terms_version','terms_accepted','privacy_document_id','privacy_version','privacy_acknowledged','privacy_consent','legal_accepted_at','additional_fee_paid_at','additional_fee_paid_by','approved_by','approved_at','rejected_by','rejected_at','rejection_reason'].includes(key)))return res.status(403).json({error:'Booking legal acceptance and audit records cannot be edited directly.'});
  if(['PATCH','PUT'].includes(req.method)&&Object.prototype.hasOwnProperty.call(req.body||{},'rebooking_status'))return res.status(400).json({error:'Use the reschedule request and decision actions to change request status.'});
  if(['PATCH','PUT'].includes(req.method)&&Object.prototype.hasOwnProperty.call(req.body||{},'booking_date'))return res.status(400).json({error:'Use a booking reschedule action to change reservation dates.'});
  if(['PATCH','PUT'].includes(req.method)&&req.body?.status==='confirmed')return res.status(400).json({error:'Use the booking acceptance action to confirm a reservation and verify its submitted payment.'});
  if(['PATCH','PUT'].includes(req.method)&&req.body?.status==='rejected')return res.status(400).json({error:'Use the booking rejection action and provide a reason.'});
  if(['PATCH','PUT'].includes(req.method)&&req.body?.status==='completed'){
   await expirePastPendingBookings();
   const bookingId=String(req.query.id||'');
   const [rows]=await pool.query('SELECT status FROM bookings WHERE id=? LIMIT 1',[bookingId]);
   if(rows[0]?.status!=='confirmed')return res.status(409).json({error:'Only an active confirmed reservation can be marked completed.'});
  }
  const modifiesDamageFee=['additional_fee_amount','additional_fee_reason','additional_fee_status'].some((field)=>Object.prototype.hasOwnProperty.call(req.body||{},field));
  if(['PATCH','PUT'].includes(req.method)&&entity==='Booking'&&modifiesDamageFee){
   if(req.body.additional_fee_status==='paid')return res.status(400).json({error:'Use the damage-fee payment confirmation action to record payment.'});
   const [feeRows]=await pool.query('SELECT additional_fee_status FROM bookings WHERE id=? LIMIT 1',[String(req.query.id||'')]);
   if(feeRows[0]?.additional_fee_status==='paid')return res.status(409).json({error:'A paid damage fee cannot be changed.'});
  }
  if(['PATCH','PUT'].includes(req.method)&&req.body?.payment_status==='paid')return res.status(400).json({error:'Payment verification is completed as part of booking acceptance.'});
  if(['PATCH','PUT'].includes(req.method)&&req.body?.additional_fee_status==='paid')return res.status(400).json({error:'Use the damage-fee payment confirmation action to record payment.'});
  return next();
 }catch(error){return next(error);}
}
async function bookingCreationLock(req,res,next){const entity=String(req.query.entity||'');const bookingCreate=req.method==='POST'&&entity==='Booking';const manualScheduleWrite=entity==='UpcomingSchedule'&&(req.method==='POST'||(['PATCH','PUT'].includes(req.method)&&Object.prototype.hasOwnProperty.call(req.body||{},'schedule_date')));if((!bookingCreate&&!manualScheduleWrite)||!req.user)return next();let connection;let acquired=false;let released=false;const release=async()=>{if(released||!connection)return;released=true;if(acquired)await releaseNamedLock(connection);connection.release();};try{connection=await pool.getConnection();const [rows]=await connection.query('SELECT GET_LOCK(?,10) AS acquired',[BOOKING_SCHEDULE_LOCK]);acquired=Number(rows[0]?.acquired)===1;if(!acquired){connection.release();console.warn('Booking schedule lock unavailable',{requestId:req.requestId,method:req.method,path:req.path,stage:'acquire_schedule_lock'});return res.status(503).json({error:'Schedule is busy. Please try again.',request_id:req.requestId});}res.once('finish',release);res.once('close',release);return next();}catch(error){if(connection&&!acquired)connection.release();return next(error);}}
async function validate(entity,record,exclude,db=pool){
 if(entity==='Package'){
  if(!String(record.name||'').trim())throw Object.assign(new Error('Package name is required.'),{status:422});
  const prices=['day_tour_price','night_tour_price','twenty_two_hour_price','price'].map(x=>Number(record[x]||0));
  if(Math.max(...prices)<=0)throw Object.assign(new Error('Please add at least one package price.'),{status:422});
  if(record.is_active!==false){const [r]=await pool.query('SELECT id FROM packages WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) AND is_active=1 AND id<>? LIMIT 1',[record.name,exclude||'']);if(r[0])throw Object.assign(new Error('An active package with this name already exists.'),{status:409});}
 }
 if(entity==='Booking'){
  if(!exclude)await applyBookingPricing(record,db);
  const date=dateOnly(record.booking_date);
  if(!isValidDateKey(date)||!getTourTime(record.tour_type))throw Object.assign(new Error('Booking date and tour type must be valid.'),{status:422});
  if(date<=dateKeyFromDate(new Date()))throw Object.assign(new Error('Choose a future booking date.'),{status:422});
  const guests=Number(record.guest_count||0);
  if(guests<1)throw Object.assign(new Error('Guest count must be at least 1.'),{status:422});
  if(!exclude&&!await databaseScheduleIsAvailable(db,date,record.tour_type,null,db!==pool))throw httpError('The selected schedule is unavailable. Please choose another date or time.',409,'BOOKING_SCHEDULE_UNAVAILABLE');
 }
 if(entity==='LegalDocument'){
  if(!['terms','privacy'].includes(record.document_type))throw httpError('Choose Terms & Conditions or Privacy Notice.',422);
  if(!String(record.title||'').trim())throw httpError('A legal document title is required.',422);
  if(!String(record.content||'').trim())throw httpError('Legal document content is required.',422);
  if(String(record.content).length>100000)throw httpError('Legal document content must be 100,000 characters or fewer.',422);
  if(!/^\d{1,4}(?:\.\d{1,4}){0,2}$/.test(String(record.version||'')))throw httpError('Use a version such as 1.0 or 1.1.',422);
  const [duplicates]=await db.query('SELECT id FROM legal_documents WHERE document_type=? AND version=? AND id<>? LIMIT 1',[record.document_type,record.version,exclude||'']);
  if(duplicates[0])throw httpError('That version already exists. Choose a new version number.',409);
 }
 if(entity==='Review'){const rating=Number(record.rating||0);if(rating<1||rating>5)throw Object.assign(new Error('Rating must be between 1 and 5.'),{status:422});}
}
function blockPublicBookingEmailFilter(req,res,next){
 if(req.method!=='GET'||String(req.query.entity||'')!=='Booking'||req.user||!req.query.filter)return next();
 let filter;
 try{filter=JSON.parse(req.query.filter);}catch{return res.status(422).json({error:'Invalid booking filter.'});}
 if(Object.prototype.hasOwnProperty.call(filter||{},'customer_email'))return res.status(403).json({error:'Sign in to view your reservations.'});
 return next();
}
async function applyBookingPricing(record,db=pool){
 if(!record.package_id)throw httpError('Choose a package before submitting your reservation.',422);
 const [rows]=await db.query('SELECT name,price,day_tour_price,night_tour_price,twenty_two_hour_price FROM packages WHERE id=? AND is_active=1 LIMIT 1',[record.package_id]);
 if(!rows[0])throw httpError('The selected package is unavailable. Please choose another package.',422);
 record.package_name=rows[0].name;
 Object.assign(record,quoteBooking({packageRecord:rows[0],tourType:record.tour_type,guestCount:record.guest_count,paymentType:record.payment_type||'downpayment'}));
}
async function validateBookingSubmission(record,db=pool,proofToken=null,userId=null){
 if(!String(record.customer_name||'').trim()||!String(record.customer_email||'').trim()||!String(record.customer_phone||'').trim())throw httpError('Your name, email, and phone number are required to submit a booking.',422);
 record.customer_name=String(record.customer_name).trim();
  Object.assign(record,validateRequiredBookingPayment(record,{allowMissingDetails:true}));
 if(!String(record.payment_mode||'').trim()||!record.payment_qr_code_id)throw httpError('Choose a payment method before submitting your booking.',422);
  const [methods]=await db.query('SELECT id,label,account_number FROM payment_qr_codes WHERE id=? AND is_active=1 LIMIT 1',[record.payment_qr_code_id]);
 if(!methods[0])throw httpError('The selected payment method is unavailable. Refresh the page and choose another method.',422);
  record.payment_qr_code_label=methods[0].label;
  record.payment_mode=methods[0].label;
 if(!String(record.receipt_url||'').trim()||!uploadedReceiptPath(record.receipt_url))throw httpError('Upload a valid payment proof image before submitting your booking.',422);
 const claims=getPaymentProofUploadClaims(proofToken,{userId,fileUrl:record.receipt_url,secret:process.env.JWT_SECRET});
 if(!claims)throw httpError('Upload a new payment proof using your signed-in account before submitting this booking.',403);
  const ocr=claims.ocr||createEmptyReceiptOcr();
  const latestAllowedDate=dateKeyFromDate(new Date());
  const signals=validateReceiptSignals({
   ocr,
   requiredAmount:record.payment_amount_due,
   selectedMethod:methods[0].label,
   expectedAccountNumber:methods[0].account_number,
   submittedPaymentNumber:record.payment_number,
   submittedReference:record.payment_reference_number,
   latestAllowedDate,
  });
  if(signals.paymentNumber)record.payment_number=signals.paymentNumber;
  if(signals.paymentReference)record.payment_reference_number=signals.paymentReference;
  let duplicateReference=false;
  if(signals.paymentReference){
   const [duplicates]=await db.query('SELECT id FROM bookings WHERE LOWER(payment_reference_number)=LOWER(?) OR LOWER(payment_proof_ocr_reference)=LOWER(?) LIMIT 1',[signals.paymentReference,signals.paymentReference]);
   duplicateReference=duplicates.some((booking)=>booking.id!==record.id);
  }
  const selectedProvider=classifyPaymentProvider(methods[0].label);
  const successfulSignals=Number(ocr.confidence)>=MIN_CONFIDENT_VERIFICATION
   &&Boolean(signals.detectedProvider&&selectedProvider===signals.detectedProvider)
   &&signals.amount!==null&&Math.abs(signals.amount-Number(record.payment_amount_due))<=0.01
   &&Boolean(signals.extractedPaymentNumber)&&Boolean(signals.extractedReference)&&Boolean(signals.date)
   &&signals.date===latestAllowedDate&&ocr.status==='successful';
  record.payment_proof_ocr_provider=signals.detectedProvider;
  record.payment_proof_ocr_amount=signals.amount;
  record.payment_proof_ocr_reference=signals.extractedReference;
  record.payment_proof_ocr_date=signals.date;
  record.payment_proof_ocr_confidence=signals.confidence;
  record.payment_status=signals.declineReason||duplicateReference?'declined':'pending_verification';
  if(signals.declineReason||duplicateReference){
   record.status='rejected';
   record.rejected_at=now();
   record.rejection_reason=signals.declineReason||'Invalid payment/reference information.';
   record.payment_proof_review='auto_declined';
  }else if(record.payment_proof_review==='duplicate_needs_review'){
   record.payment_proof_review='duplicate_needs_review';
  }else{
   record.payment_proof_review=successfulSignals?'verified':'needs_manual_review';
  }
}
async function validateBookingLegalAcceptance(record,payload,db){
 if(payload?.terms_accepted!==true||payload?.privacy_acknowledged!==true||payload?.privacy_consent!==true)throw httpError('Accept the Terms & Conditions, acknowledge the Privacy Notice, and give separate processing consent before booking.',422);
 const [documents]=await db.query("SELECT id,document_type,version FROM legal_documents WHERE status='published' AND document_type IN ('terms','privacy') FOR UPDATE");
 const terms=documents.find((document)=>document.document_type==='terms');
 const privacy=documents.find((document)=>document.document_type==='privacy');
 if(!terms||!privacy)throw httpError('Booking policies are not published yet. Please contact the resort.',503);
 if(payload.terms_document_id!==terms.id||payload.terms_version!==terms.version||payload.privacy_document_id!==privacy.id||payload.privacy_version!==privacy.version)throw httpError('The booking policies changed. Review the current Terms & Conditions and Privacy Notice, then submit again.',409,'BOOKING_POLICIES_CHANGED');
 record.terms_document_id=terms.id;
 record.terms_version=terms.version;
 record.terms_accepted=1;
 record.privacy_document_id=privacy.id;
 record.privacy_version=privacy.version;
 record.privacy_acknowledged=1;
 record.privacy_consent=1;
 record.legal_accepted_at=now();
}
async function enforceBookingNotice(req,res,next){try{const entity=String(req.query.entity||'');const body=req.body||{};const rebooking=body.rebooking_status==='requested';if(!['PATCH','PUT'].includes(req.method)||entity!=='Booking'||!rebooking||isAdmin(req.user))return next();if(!req.user)return res.status(401).json({error:'Not authenticated.'});const rid=String(req.query.id||'');if(!rid)return next();const [rows]=await pool.query('SELECT * FROM bookings WHERE id=? LIMIT 1',[rid]);const booking=rows[0];if(!booking||String(booking.customer_email).toLowerCase()!==String(req.user.email||'').toLowerCase())return next();if(!['pending','confirmed'].includes(booking.status)||(booking.rebooking_status||'none')==='pending'||Number(booking.rebooking_count||0)>=1)return res.status(409).json({error:'This booking is not eligible for another rebooking request.'});return next();}catch(error){return next(error);}}
async function handler(req,res,next){try{const entity=String(req.query.entity||'');const cfg=MAP[entity];if(!cfg)return res.status(404).json({error:`Unsupported entity: ${entity}`});const table=cfg.table;const fields=cfg.fields;const method=req.method;const admin=isAdmin(req.user);if(entity==='LostItemReport'&&!admin)return res.status(403).json({error:'Forbidden.'});if(['ActivityLog','User'].includes(entity)&&!admin&&(method!=='GET'||!req.user))return res.status(403).json({error:'Forbidden.'});if(entity==='User'&&req.user?.role!=='super_admin'&&req.user?.app_role!=='super_admin')return res.status(403).json({error:'Forbidden.'});if(!admin&&['Booking','PaymentQrCode','SiteSetting'].includes(entity)&&method!=='GET')return res.status(403).json({error:'Forbidden.'});if(!admin&&entity==='Review'&&method!=='GET'&&method!=='POST')return res.status(403).json({error:'Forbidden.'});if(!admin&&['Package','ResortRule','UpcomingSchedule','FoundItem'].includes(entity)&&!['GET','POST'].includes(method))return res.status(403).json({error:'Forbidden.'});
if(method==='GET'){if(entity==='Booking'){await expirePastPendingBookings();await declineOutdatedPendingReceipts();}const where=[],vals=[];if(entity==='Notification'){if(!req.user)return res.status(401).json({error:'Not authenticated.'});where.push('LOWER(user_email)=LOWER(?)');vals.push(req.user.email);}let filter={};try{filter=req.query.filter?JSON.parse(req.query.filter):{};}catch{}for(const [f,v] of Object.entries(filter)){if(!fields.includes(f))continue;if(Array.isArray(v)&&v.length){where.push(`\`${f}\` IN (${v.map(()=>'?').join(',')})`);vals.push(...v.map(x=>serialize(cfg,f,x)));}else{where.push(`\`${f}\`=?`);vals.push(serialize(cfg,f,v));}}if(!admin&&['Package','PaymentQrCode','ResortRule','FoundItem'].includes(entity)){where.push('is_active=1');}if(!admin&&entity==='Review'){where.push('is_approved=1');}if(entity==='ActivityLog'&&!admin){if(!req.user)return res.status(403).json({error:'Forbidden.'});where.push('user_email=?');vals.push(req.user.email);}if(entity==='Booking'&&!admin&&req.user){where.push('LOWER(customer_email)=LOWER(?)');vals.push(req.user.email);}if(entity==='Booking'&&!req.user&&!filter.customer_email){where.push("status IN ('pending','confirmed','completed')");}let sql=`SELECT * FROM \`${table}\``;if(where.length)sql+=' WHERE '+where.join(' AND ');const sort=String(req.query.sort||'');if(sort){const desc=sort.startsWith('-'),sf=desc?sort.slice(1):sort;if(fields.includes(sf))sql+=` ORDER BY \`${sf}\` ${desc?'DESC':'ASC'}`;}if(/^\d+$/.test(String(req.query.limit||'')))sql+=` LIMIT ${Math.min(500,Number(req.query.limit))} OFFSET ${Math.max(0,/^\d+$/.test(String(req.query.offset||''))?Number(req.query.offset):0)}`;const [rows]=await pool.query(sql,vals);return res.json(rows.map(r=>{const item=deserialize(cfg,r);if(entity==='Booking'&&!admin&&(!req.user||String(item.customer_email||'').toLowerCase()!==String(req.user.email||'').toLowerCase()))return {id:item.id,package_id:item.package_id,package_name:item.package_name,tour_type:item.tour_type,booking_date:item.booking_date,guest_count:item.guest_count,status:item.status};return item;}));}
if(method==='POST'){if(!admin&&!['ActivityLog','Booking','Review'].includes(entity)&&!(entity==='FoundItem'&&req.user))return res.status(403).json({error:'Forbidden.'});if(!req.user&&['ActivityLog','Booking','Review','FoundItem'].includes(entity))return res.status(401).json({error:'Not authenticated.'});const p=req.body||{},n=now(),record={};for(const f of fields)if(Object.prototype.hasOwnProperty.call(p,f))record[f]=p[f];record.id=record.id||id(entity.toLowerCase());record.created_date=record.created_date||n;record.updated_date=n;if(entity==='ActivityLog'&&!admin){record.user_email=req.user.email;record.user_name=req.user.full_name;}if(entity==='Booking'){record.customer_email=req.user.email;record.booking_reference=record.booking_reference||`KI-${cryptoRandom(4)}`;record.status='pending';record.payment_status=record.receipt_url?'pending_verification':'unpaid';record.payment_proof_review=record.receipt_url?'needs_manual_review':null;record.payment_proof_fingerprint=null;if(record.receipt_url){const proofPath=uploadedReceiptPath(record.receipt_url);if(proofPath){record.payment_proof_fingerprint=createHash('sha256').update(fs.readFileSync(proofPath)).digest('hex');const [duplicates]=await pool.query('SELECT id FROM bookings WHERE payment_proof_fingerprint=? LIMIT 1',[record.payment_proof_fingerprint]);if(duplicates.length)record.payment_proof_review='duplicate_needs_review';}}}if(entity==='Review'&&!admin){const [bookings]=await pool.query('SELECT id,booking_reference,package_name,customer_name,customer_email,status FROM bookings WHERE id=? LIMIT 1',[record.booking_id]);const booking=bookings[0];if(!booking||String(booking.customer_email).toLowerCase()!==String(req.user.email).toLowerCase()||booking.status!=='completed')return res.status(403).json({error:'A review can only be submitted for your completed booking.'});Object.assign(record,{booking_reference:booking.booking_reference,package_name:booking.package_name,guest_name:booking.customer_name,guest_email:booking.customer_email});}if(entity==='FoundItem'&&!admin){delete record.is_active;delete record.status;record.found_by=req.user.full_name||req.user.email;record.status='unclaimed';record.is_active=false;}if(entity==='Package'){record.is_active=record.is_active!==false;record.price=Number(record.price||0);record.max_guests=Number(record.max_guests||1);}if(entity==='FoundItem'&&admin)record.status=record.status||'unclaimed';if(entity==='LostItemReport')record.status=record.status||'searching';await validate(entity,record);if(entity==='Booking')await validateBookingSubmission(record);const cols=[],qs=[],vals=[];for(const f of fields)if(Object.prototype.hasOwnProperty.call(record,f)){cols.push(`\`${f}\``);qs.push('?');vals.push(serialize(cfg,f,record[f]));}await pool.query(`INSERT INTO \`${table}\` (${cols.join(',')}) VALUES (${qs.join(',')})`,vals);const [r]=await pool.query(`SELECT * FROM \`${table}\` WHERE id=? LIMIT 1`,[record.id]);return res.status(201).json(deserialize(cfg,r[0]||record));}
if(['PATCH','PUT'].includes(method)){const rid=String(req.query.id||'');if(!rid)return res.status(422).json({error:'Missing entity id.'});const [existing]=await pool.query(`SELECT * FROM \`${table}\` WHERE id=? LIMIT 1`,[rid]);if(!existing[0])return res.status(404).json({error:'Record not found.'});if(!admin){if(entity!=='Booking'||String(existing[0].customer_email).toLowerCase()!==String(req.user?.email||'').toLowerCase())return res.status(403).json({error:'Forbidden.'});const patch=req.body||{};const allowed=new Set(['status']);if(Object.keys(patch).some(key=>!allowed.has(key))||(patch.status&&patch.status!=='cancelled')||(patch.rebooking_status&&patch.rebooking_status!=='requested'))return res.status(403).json({error:'Forbidden.'});}const record={...existing[0],...(req.body||{}),updated_date:now()};await validate(entity,record,rid);const updates=[],vals=[];for(const f of fields)if(f!=='id'&&Object.prototype.hasOwnProperty.call(req.body||{},f)){updates.push(`\`${f}\`=?`);vals.push(serialize(cfg,f,req.body[f]));}updates.push('updated_date=?');vals.push(record.updated_date,rid);await pool.query(`UPDATE \`${table}\` SET ${updates.join(',')} WHERE id=?`,vals);const [r]=await pool.query(`SELECT * FROM \`${table}\` WHERE id=? LIMIT 1`,[rid]);return res.json(deserialize(cfg,r[0]));}
if(method==='DELETE'){if(!admin)return res.status(403).json({error:'Forbidden.'});const rid=String(req.query.id||'');if(!rid)return res.status(422).json({error:'Missing entity id.'});await pool.query(`DELETE FROM \`${table}\` WHERE id=?`,[rid]);return res.json({success:true,id:rid});}return res.status(405).json({error:'Method not allowed.'});}catch(e){next(e);}}
function cryptoRandom(n){return require('crypto').randomBytes(n).toString('hex').toUpperCase().slice(0,8);}
function dateOnly(value){return value instanceof Date?value.toISOString().slice(0,10):String(value||'').slice(0,10);}
function uploadedReceiptPath(receiptUrl){try{const pathname=new URL(String(receiptUrl||''),'http://local.invalid').pathname;const match=pathname.match(/(?:^|\/)uploads\/(.+)$/i);if(!match)return null;const relativePath=decodeURIComponent(match[1]);for(const rootDirectory of [uploadsDir,bundledUploadsDir]){const root=path.resolve(rootDirectory)+path.sep;const candidate=path.resolve(rootDirectory,relativePath);if(candidate.startsWith(root)&&fs.existsSync(candidate)&&fs.statSync(candidate).isFile())return candidate;}return null;}catch{return null;}}
async function notificationAction(req,res,next){if(String(req.query.entity||'')!=='Notification')return next();if(!req.user)return res.status(401).json({error:'Not authenticated.'});const email=String(req.user.email||'').toLowerCase();const action=String(req.query.action||'');if(req.method==='GET'&&action==='unread-count'){const [rows]=await pool.query('SELECT COUNT(*) AS count FROM notifications WHERE LOWER(user_email)=? AND is_read=0',[email]);return res.json({count:Number(rows[0]?.count||0)});}if(req.method==='PATCH'&&action==='mark-all-read'){const [result]=await pool.query('UPDATE notifications SET is_read=1 WHERE LOWER(user_email)=? AND is_read=0',[email]);return res.json({success:true,updated:Number(result.affectedRows||0)});}if(req.method==='PATCH'&&!action){const notificationId=String(req.query.id||'');if(!notificationId||Object.keys(req.body||{}).length!==1||req.body?.is_read!==true)return res.status(403).json({error:'Only marking your own notification as read is allowed.'});const [result]=await pool.query('UPDATE notifications SET is_read=1 WHERE id=? AND LOWER(user_email)=?',[notificationId,email]);if(!result.affectedRows)return res.status(404).json({error:'Notification not found.'});return res.json({id:notificationId,is_read:true});}if(req.method==='GET'&&!action)return next();return res.status(405).json({error:'Method not allowed.'});}
async function bookingEventNotifications(req,res,next){if(String(req.query.entity||'')!=='Booking'||!['POST','PATCH','PUT'].includes(req.method))return next();const isCreate=req.method==='POST';let before=null;if(!isCreate){const bookingId=String(req.query.id||'');if(bookingId){const [rows]=await pool.query('SELECT * FROM bookings WHERE id=? LIMIT 1',[bookingId]);before=rows[0]||null;}}const sendJson=res.json.bind(res);res.json=(payload)=>{const result=sendJson(payload);if(res.statusCode<400){const booking=isCreate?payload:(payload?.data||payload);if(booking?.id){void (async()=>{if(isCreate){const description=`${booking.booking_reference||booking.id} · ${booking.package_name||'Package'} · ${dateOnly(booking.booking_date)}`;await notifySafely({email:booking.customer_email,eventKey:`booking:${booking.id}:submitted`,title:'Your booking is pending confirmation',description,link:'/MyBookings',entityId:booking.id});await notifyBookingAdmins(booking);if(booking.payment_status==='pending_verification'){await notifyBookingAdmins(booking,{eventKey:`booking:${booking.id}:proof-submitted`,title:'Payment proof submitted',description:`${booking.booking_reference||booking.id} · ${booking.payment_mode||booking.payment_qr_code_label||'Payment method'} · Awaiting manual review.`});}return;}if(!before)return;const old=deserialize(MAP.Booking,before);if(old.status!==booking.status){await notifySafely({email:booking.customer_email,eventKey:`booking:${booking.id}:status:${old.status}:${booking.status}:${booking.updated_date}`,title:booking.status==='confirmed'?'Your booking has been confirmed':`Booking ${String(booking.status||'updated').replace(/_/g,' ')}`,description:`${booking.booking_reference||booking.id} · ${booking.package_name||'Booking'} on ${dateOnly(booking.booking_date)}.`,link:'/MyBookings',entityId:booking.id});}if(old.payment_status!==booking.payment_status){await notifySafely({email:booking.customer_email,eventKey:`booking:${booking.id}:payment:${old.payment_status}:${booking.payment_status}:${booking.updated_date}`,title:booking.payment_status==='paid'?'Payment verified':'Payment status updated',description:`${booking.booking_reference||booking.id} · ${String(booking.payment_status||'').replace(/_/g,' ')}.`,link:'/MyBookings',entityId:booking.id});}if(dateOnly(old.booking_date)!==dateOnly(booking.booking_date)){const summary=`${booking.booking_reference||booking.id} · Old date: ${dateOnly(old.booking_date)}. New date: ${dateOnly(booking.booking_date)}.`;await notifySafely({email:booking.customer_email,eventKey:`booking:${booking.id}:rescheduled:${dateOnly(booking.booking_date)}`,title:'Your booking schedule has been updated',description:summary,link:'/MyBookings',entityId:booking.id});await notifyBookingAdmins({...booking,customer_name:before.customer_name},{eventKey:`booking:${booking.id}:schedule:${dateOnly(booking.booking_date)}`,title:`Booking schedule updated`,description:summary});}if(old.rebooking_status!=='pending'&&booking.rebooking_status==='pending'){await notifyBookingAdmins({...booking,customer_name:before.customer_name},{eventKey:`booking:${booking.id}:reschedule-request:${dateOnly(booking.rebooking_requested_date||booking.booking_date)}`,title:'Reschedule request received',description:'A reschedule request was submitted. Review the booking in reservation management.'});}})().catch(error=>console.error('Booking notifications failed',{code:error.code,bookingId:booking.id}));}}return result;};return next();}
router.use(auth,enforceBookingNotice,bookingCreationLock,blockPublicBookingEmailFilter,bookingEventNotifications,bookingAction,legalDocumentAction,notificationAction,handler); module.exports=router;

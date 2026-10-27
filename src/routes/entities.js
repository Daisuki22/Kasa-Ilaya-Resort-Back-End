const express=require('express'); const router=express.Router(); const {pool,ensurePaymentQrCodeImageCapacity}=require('../config/database'); const {id,now,publicUser,isAdmin}=require('../utils'); const {auth}=require('../middleware/auth');
const {randomUUID,createHash}=require('node:crypto');
const {getPaymentProofUploadClaims}=require('../services/paymentProofUpload');
const {classifyPaymentProvider,createEmptyReceiptOcr,MIN_CONFIDENT_VERIFICATION,recognizeReceipt}=require('../services/receiptOcr');
const fs=require('node:fs');
const path=require('node:path');
const {uploadsDir,bundledUploadsDir}=require('../config/uploads');
const {createNotification,notifySafely,notifyBookingAdmins,sendBookingSubmissionEmails,sendBookingStatusEmail}=require('../services/notifications');
const {quoteBooking}=require('../services/bookingPricing');
const {findExistingBookingSubmission}=require('../services/bookingSubmission');
const {validateRequiredBookingPayment}=require('../services/bookingPaymentValidation');
const {validateReceiptSignals}=require('../services/receiptValidation');
const {synchronizeBookingStatuses}=require('../services/bookingExpiration');
const {ACTIVE_BOOKING_STATUSES,addDateKeyDays,calendarDaysUntil,dateKeyFromDate,getTodayManilaDate,getBookingEndDateTime,getBookingStartDateTime,getTourTime,isBookingCancellationAllowed,isScheduleAvailable,isTourStartTimePassed,isValidDateKey}=require('../services/bookingSchedule');
const BOOKING_SCHEDULE_LOCK='kasa_ilaya_booking_schedule';
const MAP={
 ActivityLog:{table:'activity_logs',fields:['id','created_date','updated_date','user_email','user_name','actor_role','action','entity_type','entity_id','details']},
 Booking:{table:'bookings',fields:['id','created_date','updated_date','booking_reference','package_id','package_name','tour_type','booking_date','guest_count','included_guest_count','customer_user_id','customer_name','customer_email','customer_phone','special_requests','total_amount','reservation_fee_amount','payment_type','payment_amount_due','payment_mode','payment_number','payment_reference_number','payment_qr_code_id','payment_qr_code_label','receipt_url','payment_proof_review','payment_proof_fingerprint','payment_proof_ocr_provider','payment_proof_ocr_amount','payment_proof_ocr_reference','payment_proof_ocr_date','payment_proof_ocr_confidence','terms_document_id','terms_version','terms_accepted','privacy_document_id','privacy_version','privacy_acknowledged','privacy_consent','legal_accepted_at','status','approved_by','approved_at','rejected_by','rejected_at','rejection_reason','payment_status','additional_fee_amount','additional_fee_reason','additional_fee_items','additional_fee_status','additional_fee_paid_at','additional_fee_paid_by','rebooking_status','rebooking_original_date','rebooking_requested_date','rebooking_requested_package_id','rebooking_requested_package_name','rebooking_requested_total_amount','rebooking_additional_payment_amount','rebooking_additional_payment_paid_at','rebooking_additional_payment_paid_by','rebooking_reason','rebooking_requested_at','rebooking_resolved_at','rebooking_resolution_note','rebooking_count'],json:['additional_fee_items'],bool:['terms_accepted','privacy_acknowledged','privacy_consent'],numeric:['guest_count','included_guest_count','total_amount','reservation_fee_amount','payment_amount_due','payment_proof_ocr_amount','payment_proof_ocr_confidence','additional_fee_amount','rebooking_requested_total_amount','rebooking_additional_payment_amount','rebooking_count']},
 FoundItem:{table:'found_items',fields:['id','created_date','updated_date','item_name','description','date_found','location_found','found_by','status','image_url','claimed_guest_name','claimed_contact','claimed_reservation_id','proof_of_ownership','released_by','date_claimed','is_active']},
 LostItemReport:{table:'lost_item_reports',fields:['id','created_date','updated_date','guest_name','reservation_number','item_lost','description','date_lost','contact_number','email','status','matched_item_id']},
 Package:{table:'packages',fields:['id','created_date','updated_date','name','description','tour_type','price','day_tour_price','night_tour_price','twenty_two_hour_price','max_guests','inclusions','gallery_images','image_url','is_active'],json:['inclusions','gallery_images'],bool:['is_active'],numeric:['price','day_tour_price','night_tour_price','twenty_two_hour_price','max_guests']},
 PaymentQrCode:{table:'payment_qr_codes',fields:['id','created_date','updated_date','label','account_name','account_number','instructions','image_url','display_order','is_active'],bool:['is_active'],numeric:['display_order']},
 ResortRule:{table:'resort_rules',fields:['id','created_date','updated_date','title','description','sort_order','is_active'],bool:['is_active'],numeric:['sort_order']},
 SiteSetting:{table:'site_settings',fields:['id','created_date','updated_date','site_name','logo_url','hero_image_url','hero_images_json','packages_banner_url','packages_banner_images_json','hero_badge_text','hero_title_line1','hero_title_line2','hero_description','body_font_style','heading_font_style','amenities_section_label','amenities_section_title','amenities_section_description','resort_gallery_json','terms_title','terms_summary','terms_content','amenities_json','require_strong_password','min_password_length','session_timeout_minutes','max_login_attempts','lockout_minutes','enable_login_notifications'],bool:['require_strong_password','enable_login_notifications'],numeric:['min_password_length','session_timeout_minutes','max_login_attempts','lockout_minutes'],json:['hero_images_json','packages_banner_images_json','resort_gallery_json','amenities_json']},
 LegalDocument:{table:'legal_documents',fields:['id','created_date','updated_date','document_type','title','content','version','status','created_by','published_at']},
 User:{table:'users',fields:['id','created_date','updated_date','email','full_name','birth_date','phone','profile_image_url','role','disabled','is_verified','app_id','is_service','app_role'],bool:['disabled','is_verified','is_service']},
 UpcomingSchedule:{table:'upcoming_schedules',fields:['id','created_date','updated_date','title','schedule_date','start_time','end_time','location','description','created_by_name','created_by_email']},
 Review:{table:'reviews',fields:['id','created_date','updated_date','booking_id','booking_reference','guest_name','guest_email','package_name','rating','review_text','image_url','is_approved'],bool:['is_approved'],numeric:['rating']},
 Notification:{table:'notifications',fields:['id','created_date','user_email','event_key','title','description','link','entity_type','entity_id','actor_name','actor_profile_image_url','is_read'],bool:['is_read']}
};
function isSuperAdminUser(user){return [user?.role,user?.app_role,user?._app_role].includes('super_admin');}
function getActorRole(user){const roles=[user?.app_role,user?._app_role,user?.role].map(role=>String(role||'').toLowerCase()).filter(Boolean);return roles.find(role=>!['guest','user'].includes(role))||roles[0]||'guest';}
function deserialize(cfg,row){const out={...row};if(cfg.table==='users'){out.has_local_password=Boolean(out.password_hash);delete out.password_hash;}if(cfg.table==='bookings')delete out.payment_proof_fingerprint;for(const f of cfg.json||[]){if(out[f]!==null&&out[f]!==undefined){try{out[f]=typeof out[f]==='string'?JSON.parse(out[f]):out[f];}catch{out[f]=[];}}}for(const f of cfg.bool||[])if(f in out)out[f]=!!out[f];for(const f of cfg.numeric||[])if(out[f]!==null&&out[f]!==undefined){const n=Number(out[f]);out[f]=Number.isInteger(n)?n:n;}for(const f of ['created_date','updated_date'])if(out[f] instanceof Date)out[f]=out[f].toISOString();if(out.payment_proof_ocr_date instanceof Date)out.payment_proof_ocr_date=out.payment_proof_ocr_date.toISOString().slice(0,10);return out;}
function serialize(cfg,f,v){if((cfg.json||[]).includes(f))return v==null?null:JSON.stringify(v);if((cfg.bool||[]).includes(f))return v?1:0;return v;}
async function getScheduleRows(db,fromDate,toDate,forUpdate=false){const statusSlots=ACTIVE_BOOKING_STATUSES.map(()=>'?').join(',');const lock=forUpdate?' FOR UPDATE':'';const [bookings]=await db.query(`SELECT id,DATE_FORMAT(booking_date,'%Y-%m-%d') AS booking_date,tour_type,status FROM bookings WHERE status IN (${statusSlots}) AND booking_date BETWEEN ? AND ?${lock}`,[...ACTIVE_BOOKING_STATUSES,fromDate,toDate]);const [schedules]=await db.query(`SELECT DATE_FORMAT(schedule_date,'%Y-%m-%d') AS schedule_date FROM upcoming_schedules WHERE schedule_date BETWEEN ? AND ?${lock}`,[fromDate,toDate]);return {bookings,manualDates:schedules.map(row=>row.schedule_date)};}
async function databaseScheduleIsAvailable(db,bookingDate,tourType,excludeBookingId=null,forUpdate=false){const fromDate=addDateKeyDays(bookingDate,-1);const toDate=addDateKeyDays(bookingDate,['night_tour','22_hours'].includes(tourType)?1:0);const {bookings,manualDates}=await getScheduleRows(db,fromDate,toDate,forUpdate);return isScheduleAvailable({bookingDate,tourType,bookings,manualDates,excludeBookingId});}
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
  phase='validate_schedule_availability';
  const available=await databaseScheduleIsAvailable(connection,requestedDate,booking.tour_type,booking.id,true);
  if(!available)throw httpError('The selected schedule is unavailable. Please choose another date or time.',409,'BOOKING_SCHEDULE_UNAVAILABLE');
  let nextPackageId=booking.package_id;
  let nextPackageName=booking.package_name;
  let nextTotalAmount=Number(booking.total_amount||0);
  let additionalPaymentAmount=0;
  let nextIncludedGuestCount=booking.included_guest_count;
  if((booking.rebooking_status||'none')==='pending'&&booking.rebooking_requested_package_id&&String(booking.rebooking_requested_package_id)!==String(booking.package_id)){
   phase='validate_requested_package';
   const [packageRows]=await connection.query('SELECT * FROM packages WHERE id=? AND is_active=1 FOR UPDATE',[booking.rebooking_requested_package_id]);
   const nextPackage=packageRows[0];
   if(!nextPackage)throw httpError('The requested package is no longer available. Decline this request and ask the guest to submit a new one.',409);
   const quote=quoteBooking({packageRecord:nextPackage,tourType:booking.tour_type,guestCount:booking.guest_count,paymentType:booking.payment_type||'full_payment'});
   if(booking.rebooking_requested_total_amount===null||Math.round(Number(booking.rebooking_requested_total_amount)*100)!==Math.round(quote.total_amount*100))throw httpError('The requested package price changed after submission. Decline this request and ask the guest to submit it again.',409);
   const approvedTotal=Math.max(Number(booking.total_amount||0),quote.total_amount);
   const verifiedPaidAmount=String(booking.payment_status||'').toLowerCase()==='paid'?Number(booking.payment_amount_due||booking.reservation_fee_amount||0):0;
   const expectedAdditional=Math.max(0,Number((approvedTotal-verifiedPaidAmount).toFixed(2)));
   if(Math.round(Number(booking.rebooking_additional_payment_amount||0)*100)!==Math.round(expectedAdditional*100))throw httpError('The package price difference changed. Decline this request and ask the guest to submit it again.',409);
   nextPackageId=nextPackage.id;
   nextPackageName=nextPackage.name;
   nextTotalAmount=approvedTotal;
   additionalPaymentAmount=expectedAdditional;
   nextIncludedGuestCount=Math.max(1,Math.trunc(Number(nextPackage.max_guests)||1));
  }else if((booking.rebooking_status||'none')==='pending'){
   additionalPaymentAmount=Number(booking.rebooking_additional_payment_amount||0);
  }
  const originalDate=dateOnly(booking.booking_date);
  const resolutionNote=note||(admin?'Rescheduled by resort administrator.':'Rescheduled by guest.');
  phase='update_booking';
  await connection.query("UPDATE bookings SET booking_date=?,package_id=?,package_name=?,total_amount=?,included_guest_count=?,rebooking_additional_payment_amount=?,rebooking_additional_payment_paid_at=NULL,rebooking_additional_payment_paid_by=NULL,rebooking_status='approved',rebooking_original_date=?,rebooking_requested_date=?,rebooking_requested_at=NOW(),rebooking_resolved_at=NOW(),rebooking_resolution_note=?,rebooking_count=COALESCE(rebooking_count,0)+1,updated_date=NOW() WHERE id=?",[requestedDate,nextPackageId,nextPackageName,nextTotalAmount,nextIncludedGuestCount,additionalPaymentAmount,originalDate,requestedDate,resolutionNote,booking.id]);
  const oldTime=getTourTime(booking.tour_type);
  const newTime=getTourTime(booking.tour_type);
  const details=`${admin?'Admin':'Customer'} rescheduled ${booking.booking_reference} (booking ${booking.id}) from ${originalDate} ${oldTime.label} to ${requestedDate} ${newTime.label}. Package: ${booking.package_name} to ${nextPackageName}. Guests: ${booking.guest_count}. Remaining balance payable at resort: ${additionalPaymentAmount.toFixed(2)}. Existing payment status preserved: ${booking.payment_status}.`;
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
 if(Object.keys(body).some(key=>!['booking_date','package_id','note'].includes(key))||!isValidDateKey(body.booking_date))return res.status(422).json({error:'A valid requested booking date is required.'});
 const note=typeof body.note==='string'?body.note.trim().slice(0,500):'';
 const requestedPackageId=String(body.package_id||'').trim().slice(0,64);
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
  if(String(booking.customer_email||'').toLowerCase()!==String(req.user.email||'').toLowerCase())throw httpError('You are not authorized to request a schedule change.',403);
  if(!['pending','confirmed'].includes(booking.status))throw httpError('Only an active reservation can request rescheduling.',409);
  if((booking.rebooking_status||'none')==='pending'){
   if(dateOnly(booking.rebooking_requested_date)===body.booking_date&&String(booking.rebooking_requested_package_id||booking.package_id||'')===String(requestedPackageId||booking.package_id||'')){
    await connection.commit();
    transactionStarted=false;
    return res.json({success:true,data:deserialize(MAP.Booking,booking),already_requested:true});
   }
   throw httpError('A reschedule request is already awaiting resort review.',409);
  }
  if(Number(booking.rebooking_count||0)>=1)throw httpError('This reservation has already been rescheduled.',409);
  const originalDate=booking.booking_date_key;
  if(body.booking_date===originalDate)throw httpError('Choose a different date from the current reservation.',422);
  const today=dateKeyFromDate(new Date());
  if(body.booking_date<=today)throw httpError('Choose a future date for your reservation.',422);
  const originalStart=getBookingStartDateTime(originalDate,booking.tour_type);
  if(!originalStart)throw httpError('This reservation date cannot be checked.',422);
  const rescheduleCutoff=originalStart.getTime()-7*24*60*60*1000;
  if(Date.now()>=rescheduleCutoff)throw httpError('Reschedule requests are closed starting 7 days before the tour begins.',409);
  if(!getBookingStartDateTime(body.booking_date,booking.tour_type)||!getTourTime(booking.tour_type))throw httpError('This reservation has an invalid tour schedule.',422);
  phase='validate_schedule_availability';
  if(!await databaseScheduleIsAvailable(connection,body.booking_date,booking.tour_type,booking.id,true))throw httpError('The selected schedule is unavailable. Please choose another date or time.',409,'BOOKING_SCHEDULE_UNAVAILABLE');
  let nextPackageId=booking.package_id||null;
  let nextPackageName=booking.package_name||null;
  let requestedTotalAmount=Number(booking.total_amount||0);
  let additionalPaymentAmount=0;
  if(requestedPackageId&&String(requestedPackageId)!==String(booking.package_id||'')){
   phase='validate_requested_package';
   const [packageRows]=await connection.query('SELECT * FROM packages WHERE id=? AND is_active=1 FOR UPDATE',[requestedPackageId]);
   const nextPackage=packageRows[0];
   if(!nextPackage)throw httpError('The selected package is unavailable. Please choose an active package.',422);
   const quote=quoteBooking({packageRecord:nextPackage,tourType:booking.tour_type,guestCount:booking.guest_count,paymentType:booking.payment_type||'full_payment'});
   nextPackageId=nextPackage.id;
   nextPackageName=nextPackage.name;
   requestedTotalAmount=quote.total_amount;
   const requestedTotal=Math.max(Number(booking.total_amount||0),quote.total_amount);
   const verifiedPaidAmount=String(booking.payment_status||'').toLowerCase()==='paid'?Number(booking.payment_amount_due||booking.reservation_fee_amount||0):0;
   additionalPaymentAmount=Math.max(0,Number((requestedTotal-verifiedPaidAmount).toFixed(2)));
  }
  phase='save_request';
  await connection.query("UPDATE bookings SET rebooking_status='pending',rebooking_original_date=?,rebooking_requested_date=?,rebooking_requested_package_id=?,rebooking_requested_package_name=?,rebooking_requested_total_amount=?,rebooking_additional_payment_amount=?,rebooking_reason=?,rebooking_requested_at=NOW(),rebooking_resolved_at=NULL,rebooking_resolution_note=NULL,updated_date=NOW() WHERE id=?",[originalDate,body.booking_date,nextPackageId,nextPackageName,requestedTotalAmount,additionalPaymentAmount,note||null,booking.id]);
  await connection.query('INSERT INTO activity_logs (id,created_date,updated_date,user_email,user_name,actor_role,action,entity_type,entity_id,details) VALUES (?,?,?,?,?,?,?,?,?,?)',[id('activitylog'),now(),now(),req.user.email||null,req.user.full_name||req.user.name||'Guest',getActorRole(req.user),'Requested Reschedule','Booking',booking.id,`Requested a date change for ${booking.booking_reference||booking.id} from ${originalDate} to ${body.booking_date}; package: ${nextPackageName||booking.package_name||'unchanged'}; balance payable at resort: PHP ${additionalPaymentAmount.toFixed(2)}.`]);
  const [updatedRows]=await connection.query('SELECT * FROM bookings WHERE id=? LIMIT 1',[booking.id]);
  phase='commit_transaction';
  await connection.commit();
  transactionStarted=false;
  await notifySafely({email:booking.customer_email,eventKey:`booking:${booking.id}:reschedule-requested:${body.booking_date}:${nextPackageId||'same-package'}`,title:'Your reschedule request was submitted',description:`Your request to change the date from ${originalDate} to ${body.booking_date} and package to ${nextPackageName||'the current package'} is awaiting resort review.${additionalPaymentAmount>0?` Remaining balance payable at the resort if approved: PHP ${additionalPaymentAmount.toFixed(2)}.`:''}`,link:'/MyBookings',entityId:booking.id});
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
    :'Online cancellation is no longer available within 7 days of your reservation date. Reschedule requests close 7 days before the tour begins.';
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
   void sendBookingStatusEmail(deserialize(MAP.Booking,updatedRows[0]),'cancelled')
    .catch(error=>console.error('Booking cancellation email failed',{bookingId,code:error.code}));
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
  await synchronizeBookingStatuses();
  connection=await pool.getConnection();
  await connection.beginTransaction();
  transactionStarted=true;
   const [rows]=await connection.query("SELECT *,DATE_FORMAT(booking_date,'%Y-%m-%d') AS booking_date_key FROM bookings WHERE id=? FOR UPDATE",[bookingId]);
   const booking=rows[0];
   if(!booking)throw httpError('Reservation not found.',404);
   const outdatedReceipt=booking.payment_proof_review==='auto_declined'&&/^Receipt is outdated\./i.test(String(booking.rejection_reason||''));
   if(booking.status!=='pending'&&!(outdatedReceipt&&booking.status==='rejected'))throw httpError('Only pending bookings or bookings declined solely because of an outdated receipt can be accepted.',409);
   const [packageRows]=await connection.query('SELECT name,price,day_tour_price,night_tour_price,twenty_two_hour_price,max_guests FROM packages WHERE id=? LIMIT 1 FOR UPDATE',[booking.package_id]);
   if(!packageRows[0])throw httpError('The package price could not be verified. Do not accept this payment until the booking is reviewed.',422);
   const currentQuote=quoteBooking({packageRecord:{...packageRows[0],max_guests:booking.included_guest_count||1},tourType:booking.tour_type,guestCount:booking.guest_count,paymentType:booking.payment_type||'downpayment'});
   if(Math.round(Number(booking.total_amount)*100)!==Math.round(currentQuote.total_amount*100)
    ||Math.round(Number(booking.payment_amount_due)*100)!==Math.round(currentQuote.payment_amount_due*100)){
    throw httpError('The booking fee has changed since this reservation was submitted. Do not accept this receipt; request an updated payment for the current fee.',409);
   }
   const bookingEndTime=getBookingEndDateTime(booking.booking_date_key,booking.tour_type);
   if(!bookingEndTime||bookingEndTime<=new Date())throw httpError('This booking can no longer be accepted because its checkout time has passed.',409);
   const receiptImage=await getUploadedReceiptBuffer(booking.receipt_url,connection);
   if(!receiptImage)throw httpError('A valid payment receipt is required before accepting this booking.',422);
   let refreshedReceiptOcr=null;
   if(!Number.isFinite(Number(booking.payment_proof_ocr_amount))||Number(booking.payment_proof_ocr_amount)<=0){
    try{refreshedReceiptOcr=await recognizeReceipt(receiptImage);}catch{}
   }
   if(booking.payment_status!=='pending_verification'&&!(outdatedReceipt&&booking.payment_status==='declined'))throw httpError('Only bookings with a submitted payment proof can be accepted.',422);
   if(booking.payment_proof_review==='auto_declined'&&!outdatedReceipt)throw httpError('This payment proof was automatically declined and cannot be accepted.',422);
   if(outdatedReceipt&&booking.payment_proof_fingerprint){
    const [duplicateImages]=await connection.query('SELECT id FROM bookings WHERE payment_proof_fingerprint=? AND id<>? LIMIT 1',[booking.payment_proof_fingerprint,booking.id]);
    if(duplicateImages.length)throw httpError('This receipt image was already submitted for another booking and cannot be accepted.',409);
   }
   if(outdatedReceipt){
    const receiptReference=String(booking.payment_proof_ocr_reference||booking.payment_reference_number||'').trim();
    if(receiptReference){
     const [duplicateReferences]=await connection.query('SELECT id FROM bookings WHERE id<>? AND (LOWER(payment_reference_number)=LOWER(?) OR LOWER(payment_proof_ocr_reference)=LOWER(?)) LIMIT 1',[booking.id,receiptReference,receiptReference]);
     if(duplicateReferences.length)throw httpError('This transaction reference was already used for another booking and cannot be accepted.',409);
    }
   }
   if(!String(booking.payment_mode||booking.payment_qr_code_label||'').trim())throw httpError('The booking payment method is missing.',422);
   const [qrRows]=await connection.query('SELECT id,label,is_active FROM payment_qr_codes WHERE id=? LIMIT 1 FOR UPDATE',[booking.payment_qr_code_id]);
   if(!qrRows[0]||!qrRows[0].is_active)throw httpError('The selected payment method is no longer active. Do not accept this receipt.',422);
   const receiptProvider=classifyPaymentProvider(refreshedReceiptOcr?.provider||booking.payment_proof_ocr_provider);
   const selectedProvider=classifyPaymentProvider(qrRows[0].label);
   if(receiptProvider&&selectedProvider&&receiptProvider!==selectedProvider){
    throw httpError('The receipt payment provider does not match the selected resort payment method. Do not accept this receipt.',422);
   }
   if(!Number.isFinite(Number(booking.payment_amount_due))||Number(booking.payment_amount_due)<=0)throw httpError('A valid payment amount is required before accepting this booking.',422);
   const refreshedReceiptDate=refreshedReceiptOcr?.date;
   const receiptDate=refreshedReceiptDate|| (booking.payment_proof_ocr_date instanceof Date
    ?booking.payment_proof_ocr_date.toISOString().slice(0,10)
    :String(booking.payment_proof_ocr_date||'').slice(0,10));
   if(!/^\d{4}-\d{2}-\d{2}$/.test(receiptDate))throw httpError('The receipt date could not be verified. Review the original receipt date before accepting.',422);
   if(receiptDate>getTodayManilaDate())throw httpError('The receipt date is in the future. Verify the original receipt before accepting.',422);
   const refreshedReceiptAmount=Number(refreshedReceiptOcr?.amount);
   const receiptAmount=Number.isFinite(refreshedReceiptAmount)&&refreshedReceiptAmount>0
    ?refreshedReceiptAmount:Number(booking.payment_proof_ocr_amount);
   if(!Number.isFinite(receiptAmount)||receiptAmount<=0)throw httpError('The receipt amount could not be verified. Upload a receipt showing the current booking fee.',422);
   if(Math.round(receiptAmount*100)!==Math.round(currentQuote.payment_amount_due*100)){
    throw httpError('Payment amount does not match the booking fee. An updated receipt is required.',422);
   }
  await connection.query("UPDATE bookings SET status='confirmed',approved_by=?,approved_at=NOW(),rejected_by=NULL,rejected_at=NULL,payment_status='paid',payment_proof_review='verified',rejection_reason=NULL,payment_proof_ocr_provider=COALESCE(?,payment_proof_ocr_provider),payment_proof_ocr_amount=COALESCE(?,payment_proof_ocr_amount),payment_proof_ocr_date=COALESCE(?,payment_proof_ocr_date),payment_proof_ocr_confidence=COALESCE(?,payment_proof_ocr_confidence),updated_date=NOW() WHERE id=? AND status=?",[String(req.user.id||'').slice(0,64),refreshedReceiptOcr?.provider||null,Number.isFinite(refreshedReceiptAmount)&&refreshedReceiptAmount>0?refreshedReceiptAmount:null,refreshedReceiptDate||null,Number.isFinite(Number(refreshedReceiptOcr?.confidence))?Number(refreshedReceiptOcr.confidence):null,booking.id,booking.status]);
  await connection.query('INSERT INTO activity_logs (id,created_date,updated_date,user_email,user_name,action,entity_type,entity_id,details) VALUES (?,?,?,?,?,?,?,?,?)',[id('activitylog'),now(),now(),req.user.email||null,req.user.full_name||req.user.name||'Administrator','Booking accepted and payment manually verified','Booking',booking.id,`Accepted ${booking.booking_reference} and manually verified the submitted ${booking.payment_mode||booking.payment_qr_code_label} proof for ${Number(booking.payment_amount_due).toFixed(2)}.`]);
  const [updatedRows]=await connection.query('SELECT * FROM bookings WHERE id=? LIMIT 1',[booking.id]);
  await connection.commit();
  transactionStarted=false;
  void sendBookingStatusEmail(deserialize(MAP.Booking,updatedRows[0]),'confirmed')
   .catch(error=>console.error('Booking confirmation email failed',{bookingId:booking.id,code:error.code}));
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
  const hadPendingReschedule=booking.rebooking_status==='pending';
  await connection.query("UPDATE bookings SET status='rejected',rejected_by=?,rejected_at=NOW(),rejection_reason=?,rebooking_resolved_at=IF(?=1,NOW(),rebooking_resolved_at),rebooking_resolution_note=IF(?=1,'Booking rejected; pending reschedule request closed.',rebooking_resolution_note),rebooking_status=IF(?=1,'declined',COALESCE(rebooking_status,'none')),updated_date=NOW() WHERE id=? AND status='pending'",[String(req.user.id||'').slice(0,64),reason.slice(0,1000),Number(hadPendingReschedule),Number(hadPendingReschedule),Number(hadPendingReschedule),booking.id]);
  await connection.query('INSERT INTO activity_logs (id,created_date,updated_date,user_email,user_name,action,entity_type,entity_id,details) VALUES (?,?,?,?,?,?,?,?,?)',[id('activitylog'),now(),now(),req.user.email||null,req.user.full_name||req.user.name||'Administrator','Booking rejected','Booking',booking.id,`Rejected ${booking.booking_reference||booking.id}. Reason: ${reason.slice(0,800)}${hadPendingReschedule?' Pending reschedule request was closed.':''}`]);
  const [updatedRows]=await connection.query('SELECT * FROM bookings WHERE id=? LIMIT 1',[booking.id]);
  await connection.commit();
  transactionStarted=false;
   void sendBookingStatusEmail(deserialize(MAP.Booking,updatedRows[0]),'rejected',reason)
    .catch(error=>console.error('Booking rejection email failed',{bookingId:booking.id,code:error.code}));
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
   const proofImage=await getUploadedReceiptBuffer(record.receipt_url,connection);
   if(proofImage){
    record.payment_proof_fingerprint=createHash('sha256').update(proofImage).digest('hex');
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
  await connection.query('INSERT INTO activity_logs (id,created_date,updated_date,user_email,user_name,actor_role,action,entity_type,entity_id,details) VALUES (?,?,?,?,?,?,?,?,?,?)',[id('activitylog'),record.created_date,record.created_date,req.user.email||null,req.user.full_name||req.user.name||'Guest',getActorRole(req.user),'Created Booking','Booking',record.id,`Submitted reservation ${record.booking_reference} for ${record.package_name||'a resort package'} on ${dateOnly(record.booking_date)}.`]);
  stage='read_created_booking';
  const [rows]=await connection.query('SELECT * FROM bookings WHERE id=? LIMIT 1',[record.id]);
  stage='commit_transaction';
  await connection.commit();
  transactionStarted=false;
  const createdBooking=deserialize(cfg,rows[0]||record);
  let emailDelivery={customerEmailSent:false,customerEmailError:'Booking was saved, but the email notification could not be delivered.'};
  try{emailDelivery=await sendBookingSubmissionEmails(createdBooking);}catch(error){console.error('Booking email notification failed',{requestId:req.requestId,bookingId:createdBooking.id,code:error.code});}
  return res.status(201).json({...createdBooking,email_sent:Boolean(emailDelivery.customerEmailSent),email_error:emailDelivery.customerEmailError||''});
 }catch(error){
  error.bookingStage=stage;
  error.bookingContext=bookingLogContext;
  if(transactionStarted)try{await connection.rollback();}catch{}
  return next(error);
 }finally{if(connection)connection.release();}
}
async function adminBookingPage(req,res,next){
 if(!req.user)return res.status(401).json({error:'Not authenticated.'});
 if(!isAdmin(req.user))return res.status(403).json({error:'Forbidden.'});
  try{
   await synchronizeBookingStatuses();
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
  if(paymentStatus){if(!['unpaid','pending_verification','paid','declined'].includes(paymentStatus))return res.status(422).json({error:'Choose a valid payment status.'});where.push('payment_status=?');values.push(paymentStatus);}
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
async function completeBooking(req,res){
 if(!isAdmin(req.user))return res.status(403).json({error:'Only resort administrators can complete a reservation.'});
 const bookingId=String(req.query.id||'');
 if(!bookingId)return res.status(422).json({error:'Missing booking id.'});
 const confirmedPayment=req.body?.confirm_remaining_balance_paid===true;
 let connection;
 let transactionStarted=false;
 try{
  connection=await pool.getConnection();
  await connection.beginTransaction();
  transactionStarted=true;
  const [rows]=await connection.query('SELECT * FROM bookings WHERE id=? LIMIT 1 FOR UPDATE',[bookingId]);
  const booking=rows[0];
  if(!booking)throw httpError('Reservation not found.',404);
  if(booking.status!=='confirmed')throw httpError('Only an active confirmed reservation can be marked completed.',409);
  if(dateOnly(booking.booking_date)!==getTodayManilaDate())throw httpError('A reservation can only be marked completed on its booking date.',409);
  const remainingBalance=Math.max(0,Number(booking.rebooking_additional_payment_amount||0));
  if(remainingBalance>0&&!confirmedPayment)throw httpError(`Confirm that PHP ${remainingBalance.toFixed(2)} remaining balance was collected at the resort before completing this reservation.`,409);
  const paidBy=remainingBalance>0?(req.user.email||req.user.id||null):null;
  await connection.query("UPDATE bookings SET status='completed',rebooking_additional_payment_paid_at=IF(?>0,NOW(),rebooking_additional_payment_paid_at),rebooking_additional_payment_paid_by=IF(?>0,?,rebooking_additional_payment_paid_by),updated_date=NOW() WHERE id=? AND status='confirmed'",[remainingBalance,remainingBalance,paidBy,bookingId]);
  const [updatedRows]=await connection.query('SELECT * FROM bookings WHERE id=? LIMIT 1',[bookingId]);
  await connection.query('INSERT INTO activity_logs (id,created_date,updated_date,user_email,user_name,actor_role,action,entity_type,entity_id,details) VALUES (?,?,?,?,?,?,?,?,?,?)',[id('activitylog'),now(),now(),req.user.email||null,req.user.full_name||req.user.name||null,getActorRole(req.user),'Booking completed','Booking',bookingId,`Completed ${booking.booking_reference||bookingId}. Remaining balance collected at resort: PHP ${remainingBalance.toFixed(2)}.`]);
  await connection.commit();
  transactionStarted=false;
  return res.json({success:true,data:deserialize(MAP.Booking,updatedRows[0])});
 }catch(error){
  if(transactionStarted)try{await connection.rollback();}catch{}
  const status=error.status||500;
  return res.status(status).json({error:status===500?'Unable to complete reservation.':error.message});
 }finally{if(connection)connection.release();}
}
async function listActivityLogs(req,res){
 if(!req.user)return res.status(401).json({error:'Not authenticated.'});
 const admin=isAdmin(req.user);
 const mineOnly=String(req.query.scope||'')==='mine'||!admin;
 const where=[];
 const values=[];
 if(mineOnly){where.push('LOWER(logs.user_email)=LOWER(?)');values.push(req.user.email);}
 const roleExpression="COALESCE(NULLIF(logs.actor_role,''),NULLIF(NULLIF(accounts.app_role,'guest'),'user'),NULLIF(NULLIF(accounts.role,'guest'),'user'),accounts.app_role,accounts.role,'guest')";
 let filter={};
 try{filter=req.query.filter?JSON.parse(req.query.filter):{};}catch{return res.status(422).json({error:'Invalid activity log filter.'});}
 for(const [field,value] of Object.entries(filter||{})){
  if(!MAP.ActivityLog.fields.includes(field))continue;
  if(field==='actor_role'){
   where.push(`${roleExpression}=?`);
   values.push(String(value));
  }else{
   where.push(`logs.\`${field}\`=?`);
   values.push(serialize(MAP.ActivityLog,field,value));
  }
 }
 let sql=`SELECT logs.*,${roleExpression} AS actor_role FROM activity_logs logs LEFT JOIN users accounts ON LOWER(accounts.email)=LOWER(logs.user_email)`;
 if(where.length)sql+=` WHERE ${where.join(' AND ')}`;
 const sort=String(req.query.sort||'-created_date');
 const descending=sort.startsWith('-');
 const sortField=descending?sort.slice(1):sort;
 if(MAP.ActivityLog.fields.includes(sortField))sql+=` ORDER BY logs.\`${sortField}\` ${descending?'DESC':'ASC'}`;
 if(/^\d+$/.test(String(req.query.limit||'')))sql+=` LIMIT ${Math.min(500,Number(req.query.limit))} OFFSET ${Math.max(0,/^\d+$/.test(String(req.query.offset||''))?Number(req.query.offset):0)}`;
 const [rows]=await pool.query(sql,values);
 return res.json(rows.map(row=>deserialize(MAP.ActivityLog,row)));
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
  if(req.method==='PATCH'&&action==='complete')return completeBooking(req,res);
  if(req.method==='PATCH'&&action==='request-reschedule')return requestReschedule(req,res);
  if(req.method==='PATCH'&&action==='resolve-reschedule')return rejectRescheduleRequest(req,res);
  if(req.method==='PATCH'&&action==='reschedule')return rescheduleBooking(req,res);
  if(['PATCH','PUT'].includes(req.method)&&['receipt_url','payment_proof_review','payment_proof_fingerprint','payment_proof_ocr_provider','payment_proof_ocr_amount','payment_proof_ocr_reference','payment_proof_ocr_date','payment_proof_ocr_confidence'].some((field)=>Object.prototype.hasOwnProperty.call(req.body||{},field)))return res.status(403).json({error:'Payment proof and OCR verification data cannot be edited directly. Upload a new proof and use the booking verification flow.'});
  if(['PATCH','PUT'].includes(req.method)&&Object.keys(req.body||{}).some((key)=>['terms_document_id','terms_version','terms_accepted','privacy_document_id','privacy_version','privacy_acknowledged','privacy_consent','legal_accepted_at','additional_fee_paid_at','additional_fee_paid_by','rebooking_requested_package_id','rebooking_requested_package_name','rebooking_requested_total_amount','rebooking_additional_payment_amount','rebooking_additional_payment_paid_at','rebooking_additional_payment_paid_by','approved_by','approved_at','rejected_by','rejected_at','rejection_reason'].includes(key)))return res.status(403).json({error:'Booking legal acceptance, reschedule pricing, and audit records cannot be edited directly.'});
  if(['PATCH','PUT'].includes(req.method)&&Object.prototype.hasOwnProperty.call(req.body||{},'rebooking_status'))return res.status(400).json({error:'Use the reschedule request and decision actions to change request status.'});
  if(['PATCH','PUT'].includes(req.method)&&Object.prototype.hasOwnProperty.call(req.body||{},'booking_date'))return res.status(400).json({error:'Use a booking reschedule action to change reservation dates.'});
  if(['PATCH','PUT'].includes(req.method)&&req.body?.status==='confirmed')return res.status(400).json({error:'Use the booking acceptance action to confirm a reservation and verify its submitted payment.'});
  if(['PATCH','PUT'].includes(req.method)&&req.body?.status==='rejected')return res.status(400).json({error:'Use the booking rejection action and provide a reason.'});
  if(['PATCH','PUT'].includes(req.method)&&req.body?.status==='completed')return res.status(400).json({error:'Use the reservation completion action so any remaining balance can be confirmed.'});
  const modifiesDamageFee=['additional_fee_amount','additional_fee_reason','additional_fee_items','additional_fee_status'].some((field)=>Object.prototype.hasOwnProperty.call(req.body||{},field));
  if(['PATCH','PUT'].includes(req.method)&&entity==='Booking'&&modifiesDamageFee){
   if(!isAdmin(req.user))return res.status(403).json({error:'Only resort administrators can add or update a damage fee.'});
   if(req.body.additional_fee_status==='paid')return res.status(400).json({error:'Use the damage-fee payment confirmation action to record payment.'});
   const [feeRows]=await pool.query('SELECT booking_date,payment_status,additional_fee_status FROM bookings WHERE id=? LIMIT 1',[String(req.query.id||'')]);
   if(!feeRows[0])return res.status(404).json({error:'Booking not found.'});
   const bookingDate=dateOnly(feeRows[0].booking_date);
   if(!isValidDateKey(bookingDate)||bookingDate!==getTodayManilaDate())return res.status(409).json({error:'A damage fee can only be added or updated on the booking date.'});
   if(Number(req.body.additional_fee_amount||0)>0&&String(feeRows[0].payment_status||'').toLowerCase()!=='paid')return res.status(409).json({error:'A damage fee can only be added to a booking with paid booking status.'});
   if(feeRows[0].additional_fee_status==='paid')return res.status(409).json({error:'A paid damage fee cannot be changed.'});
  }
  if(['PATCH','PUT'].includes(req.method)&&req.body?.payment_status==='paid')return res.status(400).json({error:'Payment verification is completed as part of booking acceptance.'});
  if(['PATCH','PUT'].includes(req.method)&&req.body?.additional_fee_status==='paid')return res.status(400).json({error:'Use the damage-fee payment confirmation action to record payment.'});
  return next();
 }catch(error){return next(error);}
}
async function bookingCreationLock(req,res,next){const entity=String(req.query.entity||'');const bookingCreate=req.method==='POST'&&entity==='Booking';const manualScheduleWrite=entity==='UpcomingSchedule'&&(req.method==='POST'||(['PATCH','PUT'].includes(req.method)&&Object.prototype.hasOwnProperty.call(req.body||{},'schedule_date')));if((!bookingCreate&&!manualScheduleWrite)||!req.user)return next();let connection;let acquired=false;let released=false;const release=async()=>{if(released||!connection)return;released=true;if(acquired)await releaseNamedLock(connection);connection.release();};try{connection=await pool.getConnection();const [rows]=await connection.query('SELECT GET_LOCK(?,10) AS acquired',[BOOKING_SCHEDULE_LOCK]);acquired=Number(rows[0]?.acquired)===1;if(!acquired){connection.release();console.warn('Booking schedule lock unavailable',{requestId:req.requestId,method:req.method,path:req.path,stage:'acquire_schedule_lock'});return res.status(503).json({error:'Schedule is busy. Please try again.',request_id:req.requestId});}res.once('finish',release);res.once('close',release);return next();}catch(error){if(connection&&!acquired)connection.release();return next(error);}}
function validationError(message){throw httpError(message,422);}
function hasAtMostTwoDecimals(value){const scaled=Number(value)*100;return Number.isFinite(scaled)&&Math.abs(scaled-Math.round(scaled))<1e-7;}
function validateText(record,field,label,{required=false,max=10000,nullable=true}={}){
 const value=record[field];
 if(value===undefined)return;
 if(value===null){if(required||!nullable)validationError(`${label} is required.`);return;}
 if(typeof value!=='string')validationError(`${label} must be text.`);
 const trimmed=value.trim();
 if(required&&!trimmed)validationError(`${label} is required.`);
 if(trimmed.length>max)validationError(`${label} must be ${max} characters or fewer.`);
 record[field]=trimmed||(!required&&nullable?null:'');
}
function validateEntityTypes(cfg,record){
 for(const field of cfg.numeric||[]){
  const value=record[field];
  if(value===undefined||value===null)continue;
  if(typeof value==='string'&&!value.trim())validationError(`${field.replace(/_/g,' ')} must be a number.`);
  const number=Number(value);
  if(!Number.isFinite(number))validationError(`${field.replace(/_/g,' ')} must be a valid number.`);
  record[field]=number;
 }
 for(const field of cfg.bool||[]){
  const value=record[field];
  if(value===undefined||value===null)continue;
  if([true,1,'1','true'].includes(value)){record[field]=true;continue;}
  if([false,0,'0','false'].includes(value)){record[field]=false;continue;}
  validationError(`${field.replace(/_/g,' ')} must be true or false.`);
 }
 for(const field of cfg.json||[]){
  const value=record[field];
  if(value===undefined||value===null)continue;
  if(typeof value==='string'){
   try{record[field]=JSON.parse(value);}catch{validationError(`${field.replace(/_/g,' ')} must contain valid structured data.`);}
  }
 }
}
function isSafeAssetUrl(value){
 const url=String(value||'').trim();
 return !url||url.startsWith('/uploads/')||url.startsWith('/img/')||url.startsWith('img/')
  ||/^https?:\/\/[^\s<>"']+$/i.test(url)
  ||/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(url);
}
async function validate(entity,record,exclude,db=pool,changedFields=null){
 const cfg=MAP[entity];
 if(cfg)validateEntityTypes(cfg,record);
 if(entity==='UpcomingSchedule'){
  const scheduleDate=dateOnly(record.schedule_date);
  if(!isValidDateKey(scheduleDate))throw httpError('Choose a valid schedule date.',422);
  if((!exclude||changedFields?.has('schedule_date'))&&scheduleDate<getTodayManilaDate())throw httpError('Choose today or a future date for the schedule.',422);
  validateText(record,'title','Schedule title',{required:true,max:191});
  validateText(record,'location','Schedule location',{max:191});
  validateText(record,'description','Schedule description',{max:10000});
  validateText(record,'created_by_name','Creator name',{max:191});
  validateText(record,'created_by_email','Creator email',{max:191});
  if(record.created_by_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.created_by_email))validationError('Enter a valid creator email address.');
  for(const field of ['start_time','end_time'])if(record[field]!==undefined&&record[field]!==null&&record[field]!==''&&!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(record[field])))validationError('Schedule times must use 24-hour HH:MM format.');
  if(record.start_time&&record.end_time&&record.start_time===record.end_time)validationError('Schedule end time must differ from its start time.');
  if(!exclude||changedFields?.has('schedule_date')){
   const previousDate=addDateKeyDays(scheduleDate,-1);
   const statusSlots=ACTIVE_BOOKING_STATUSES.map(()=>'?').join(',');
   const [bookings]=await db.query(`SELECT id FROM bookings WHERE status IN (${statusSlots}) AND (booking_date=? OR (tour_type IN ('night_tour','22_hours') AND booking_date=?)) LIMIT 1`,[...ACTIVE_BOOKING_STATUSES,scheduleDate,previousDate]);
   if(bookings.length)throw httpError('A booking already occupies this date. Choose another date for the schedule.',409,'BOOKING_SCHEDULE_UNAVAILABLE');
   const [schedules]=await db.query('SELECT id FROM upcoming_schedules WHERE schedule_date=? AND id<>? LIMIT 1',[scheduleDate,exclude||'']);
   if(schedules.length)throw httpError('A schedule already exists on this date. Choose another date.',409,'BOOKING_SCHEDULE_UNAVAILABLE');
  }
 }
 if(entity==='Package'){
  validateText(record,'name','Package name',{required:true,max:191});
  validateText(record,'description','Package description',{max:10000});
  if(!['day_tour','night_tour','22_hours'].includes(record.tour_type))validationError('Choose a valid package tour type.');
  const priceFields=['day_tour_price','night_tour_price','twenty_two_hour_price','price'];
  for(const field of priceFields){const value=record[field]??0;if(!Number.isFinite(Number(value))||Number(value)<0||Number(value)>99999999.99||!hasAtMostTwoDecimals(value))validationError('Package prices must be valid PHP amounts with no more than two decimal places.');record[field]=Number(value);}
  const prices=priceFields.map(x=>Number(record[x]||0));
  if(Math.max(...prices)<=0)throw Object.assign(new Error('Please add at least one package price.'),{status:422});
  if(!Number.isInteger(Number(record.max_guests))||Number(record.max_guests)<1||Number(record.max_guests)>1000)validationError('Included guest count must be a whole number from 1 to 1,000.');
  record.max_guests=Number(record.max_guests);
  if(!Array.isArray(record.inclusions)||record.inclusions.some(item=>typeof item!=='string'||!item.trim()||item.trim().length>191))validationError('Package inclusions must be a list of non-empty items up to 191 characters each.');
  record.inclusions=record.inclusions.map(item=>item.trim());
  if(!Array.isArray(record.gallery_images)||record.gallery_images.some(url=>typeof url!=='string'||url.length>5000000||!isSafeAssetUrl(url)))validationError('Package gallery images must be valid image URLs.');
  record.gallery_images=record.gallery_images.map(url=>url.trim());
  if(record.gallery_images.length>30)validationError('A package can include up to 30 gallery images.');
  if(record.image_url&&!isSafeAssetUrl(record.image_url))validationError('Choose a valid package cover image.');
  if(record.is_active!==undefined&&typeof record.is_active!=='boolean')validationError('Package status must be true or false.');
  if(record.is_active!==false){const [r]=await pool.query('SELECT id FROM packages WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) AND is_active=1 AND id<>? LIMIT 1',[record.name,exclude||'']);if(r[0])throw Object.assign(new Error('An active package with this name already exists.'),{status:409});}
 }
 if(entity==='Booking'){
  if(!exclude)await applyBookingPricing(record,db);
  const moneyFields=['total_amount','reservation_fee_amount','payment_amount_due','payment_proof_ocr_amount','additional_fee_amount','rebooking_additional_payment_amount'];
  for(const field of moneyFields)if(record[field]!==undefined&&record[field]!==null&&(record[field]<0||record[field]>99999999.99||!hasAtMostTwoDecimals(record[field])))validationError(`${field.replace(/_/g,' ')} must be a non-negative PHP amount with up to two decimal places.`);
  if(record.rebooking_requested_total_amount!==undefined&&record.rebooking_requested_total_amount!==null&&(record.rebooking_requested_total_amount<0||record.rebooking_requested_total_amount>9999999999.99||!hasAtMostTwoDecimals(record.rebooking_requested_total_amount)))validationError('Rebooking total must be a valid PHP amount.');
  if(record.payment_proof_ocr_confidence!==undefined&&record.payment_proof_ocr_confidence!==null&&(record.payment_proof_ocr_confidence<0||record.payment_proof_ocr_confidence>100))validationError('Receipt confidence must be from 0 to 100.');
  if(record.included_guest_count!==undefined&&record.included_guest_count!==null&&(!Number.isSafeInteger(record.included_guest_count)||record.included_guest_count<0||record.included_guest_count>1000))validationError('Included guest count must be a whole number from 0 to 1,000.');
  if(record.rebooking_count!==undefined&&record.rebooking_count!==null&&(!Number.isSafeInteger(record.rebooking_count)||record.rebooking_count<0))validationError('Rebooking count must be a non-negative whole number.');
  for(const [field,max] of Object.entries({booking_reference:64,package_id:64,package_name:191,payment_type:32,payment_mode:191,payment_number:64,payment_reference_number:128,payment_qr_code_id:64,payment_qr_code_label:191,payment_proof_review:32,payment_proof_ocr_provider:32,payment_proof_ocr_reference:128,terms_document_id:64,terms_version:32,privacy_document_id:64,privacy_version:32,rebooking_requested_package_id:64,rebooking_requested_package_name:191}))validateText(record,field,field.replace(/_/g,' '),{max});
  for(const [field,values] of Object.entries({status:['pending','confirmed','cancelled','completed','archived','rejected'],payment_status:['unpaid','pending_verification','paid','declined'],additional_fee_status:['pending','unpaid','paid'],rebooking_status:['none','pending','approved','declined']}))if(record[field]!==undefined&&!values.includes(record[field]))validationError(`Choose a valid ${field.replace(/_/g,' ')}.`);
  validateText(record,'rejection_reason','Rejection reason',{max:10000});
  validateText(record,'additional_fee_reason','Additional fee reason',{max:10000});
  validateText(record,'rebooking_reason','Rebooking reason',{max:10000});
  validateText(record,'rebooking_resolution_note','Rebooking resolution note',{max:10000});
  const date=dateOnly(record.booking_date);
  if(!isValidDateKey(date)||!getTourTime(record.tour_type))throw Object.assign(new Error('Booking date and tour type must be valid.'),{status:422});
  const dateChanged=!exclude||changedFields?.has('booking_date')||changedFields?.has('tour_type');
  if(dateChanged&&date<getTodayManilaDate())throw Object.assign(new Error('Choose today or a future booking date.'),{status:422});
  if(dateChanged&&isTourStartTimePassed(date,record.tour_type))throw httpError(`The ${getTourTime(record.tour_type).label} tour has already started for today. Choose another tour or date.`,409,'BOOKING_TOUR_ALREADY_STARTED');
  if(!exclude||changedFields?.has('guest_count')){const guests=Number(record.guest_count||0);if(!Number.isSafeInteger(guests)||guests<1||guests>1000)validationError('Guest count must be a whole number from 1 to 1,000.');}
  if(!exclude||changedFields?.has('customer_name'))validateText(record,'customer_name','Guest name',{required:true,max:191});
  if(!exclude||changedFields?.has('customer_email')){validateText(record,'customer_email','Guest email',{required:true,max:191});if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.customer_email))validationError('Enter a valid guest email address.');record.customer_email=record.customer_email.toLowerCase();}
  if(!exclude||changedFields?.has('customer_phone')){validateText(record,'customer_phone','Guest phone number',{required:true,max:64});const phoneDigits=record.customer_phone.replace(/\D/g,'');if(!/^[+]?[-().\s\d]+$/.test(record.customer_phone)||!/^(09\d{9}|639\d{9})$/.test(phoneDigits))validationError('Enter a valid Philippine mobile number.');}
  if(!exclude||changedFields?.has('special_requests'))validateText(record,'special_requests','Special requests',{max:5000});
  if(!exclude&&!await databaseScheduleIsAvailable(db,date,record.tour_type,null,db!==pool))throw httpError('The selected schedule is unavailable. Please choose another date or time.',409,'BOOKING_SCHEDULE_UNAVAILABLE');
 }
 if(entity==='LegalDocument'){
  if(!['terms','privacy'].includes(record.document_type))throw httpError('Choose Terms & Conditions or Privacy Notice.',422);
  validateText(record,'title','Document title',{required:true,max:191});
  validateText(record,'content','Document content',{required:true,max:100000,nullable:false});
  if(!/^\d{1,4}(?:\.\d{1,4}){0,2}$/.test(String(record.version||'')))throw httpError('Use a version such as 1.0 or 1.1.',422);
  validateText(record,'version','Document version',{required:true,max:32,nullable:false});
  if(record.status!==undefined&&!['draft','published','archived'].includes(record.status))validationError('Choose a valid document status.');
  const [duplicates]=await db.query('SELECT id FROM legal_documents WHERE document_type=? AND version=? AND id<>? LIMIT 1',[record.document_type,record.version,exclude||'']);
  if(duplicates[0])throw httpError('That version already exists. Choose a new version number.',409);
 }
 if(entity==='PaymentQrCode'){
  validateText(record,'label','Payment method name',{required:true,max:191});
  validateText(record,'account_name','Account name',{max:191});
  validateText(record,'account_number','Account number',{max:191});
  validateText(record,'instructions','Payment instructions',{max:10000});
  if(typeof record.image_url!=='string'||!record.image_url.trim()||record.image_url.length>5000000||!isSafeAssetUrl(record.image_url))validationError('Choose a valid QR image.');
  if(!Number.isInteger(Number(record.display_order))||Number(record.display_order)<1||Number(record.display_order)>2147483647)validationError('Display order must be a positive whole number.');
  record.display_order=Number(record.display_order);
 }
 if(entity==='ResortRule'){
  validateText(record,'title','Rule title',{required:true,max:191});
  validateText(record,'description','Rule description',{required:true,max:10000});
  if(!Number.isInteger(Number(record.sort_order))||Number(record.sort_order)<1||Number(record.sort_order)>2147483647)validationError('Rule order must be a positive whole number.');
  record.sort_order=Number(record.sort_order);
 }
 if(entity==='Review'){
  const rating=Number(record.rating);
  if(!Number.isInteger(rating)||rating<1||rating>5)validationError('Rating must be a whole number from 1 to 5.');
  record.rating=rating;
  validateText(record,'review_text','Review',{required:true,max:5000,nullable:false});
  validateText(record,'guest_name','Guest name',{required:true,max:191});
  validateText(record,'guest_email','Guest email',{max:191});
  validateText(record,'package_name','Package name',{max:191});
  if(record.guest_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.guest_email))validationError('Enter a valid guest email address.');
 }
 if(entity==='FoundItem'){
  validateText(record,'item_name','Item name',{required:true,max:191});
  validateText(record,'description','Item description',{max:10000});
  validateText(record,'location_found','Found location',{max:191});
  validateText(record,'found_by','Finder name',{max:191});
  const foundDate=dateOnly(record.date_found);
  if(!isValidDateKey(foundDate)||foundDate>getTodayManilaDate())validationError('Choose a valid date found that is not in the future.');
  if(!['unclaimed','claimed'].includes(record.status))validationError('Choose a valid found-item status.');
  if(record.image_url&&!isSafeAssetUrl(record.image_url))validationError('Choose a valid item image.');
  validateText(record,'proof_of_ownership','Ownership proof',{max:10000});
  const claimFields=['status','claimed_guest_name','claimed_contact','released_by','date_claimed'];
  const validateClaim=record.status==='claimed'&&(!exclude||claimFields.some(field=>changedFields?.has(field)));
  if(validateClaim){
   validateText(record,'claimed_guest_name','Claimant name',{required:true,max:191});
   validateText(record,'claimed_contact','Claimant contact',{required:true,max:191});
   validateText(record,'released_by','Released by',{required:true,max:191});
   const claimDate=dateOnly(record.date_claimed);
   if(!isValidDateKey(claimDate)||claimDate<foundDate||claimDate>getTodayManilaDate())validationError('Claim date must be on or after the found date and cannot be in the future.');
  }
 }
 if(entity==='LostItemReport'){
  validateText(record,'guest_name','Guest name',{required:true,max:191});
  validateText(record,'reservation_number','Reservation number',{max:64});
  validateText(record,'item_lost','Lost item',{required:true,max:191});
  validateText(record,'description','Item description',{max:10000});
  const lostDate=dateOnly(record.date_lost);
  if(!isValidDateKey(lostDate)||lostDate>getTodayManilaDate())validationError('Choose a valid date the item was lost that is not in the future.');
  validateText(record,'contact_number','Contact number',{max:64});
  validateText(record,'email','Email address',{max:191});
  if(record.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email))validationError('Enter a valid email address.');
  if(!['searching','matched','claimed'].includes(record.status))validationError('Choose a valid lost-item report status.');
 }
 if(entity==='SiteSetting'){
  validateText(record,'site_name','Website name',{required:true,max:191});
  const textLimits={body_font_style:64,heading_font_style:64,hero_badge_text:191,hero_title_line1:191,hero_title_line2:191,amenities_section_label:191,amenities_section_title:191,terms_title:191,hero_description:10000,amenities_section_description:10000,terms_summary:10000,terms_content:100000};
  for(const [field,max] of Object.entries(textLimits))validateText(record,field,field.replace(/_/g,' '),{max});
  for(const field of ['logo_url','hero_image_url','packages_banner_url'])if(record[field]&&!isSafeAssetUrl(record[field]))validationError(`Enter a valid ${field.replace(/_/g,' ')} image URL.`);
  for(const field of ['logo_url','hero_image_url','packages_banner_url'])if(record[field]&&record[field].length>5000000)validationError(`${field.replace(/_/g,' ')} is too large.`);
  for(const field of ['min_password_length','session_timeout_minutes','max_login_attempts','lockout_minutes']){
   if(record[field]===undefined||record[field]===null)continue;
   const value=Number(record[field]);
   const limits={min_password_length:[8,32],session_timeout_minutes:[10,1440],max_login_attempts:[1,20],lockout_minutes:[1,240]}[field];
   if(!Number.isInteger(value)||value<limits[0]||value>limits[1])validationError(`${field.replace(/_/g,' ')} must be a whole number from ${limits[0]} to ${limits[1]}.`);
   record[field]=value;
  }
  const arrays=['hero_images_json','packages_banner_images_json','resort_gallery_json','amenities_json'];
  for(const field of arrays){if(record[field]===undefined||record[field]===null)continue;if(!Array.isArray(record[field]))validationError(`${field.replace(/_/g,' ')} must be a list.`);if(record[field].length>50)validationError(`${field.replace(/_/g,' ')} can contain up to 50 items.`);}
  for(const field of ['hero_images_json','packages_banner_images_json'])if((record[field]||[]).some(url=>typeof url!=='string'||url.length>5000000||!isSafeAssetUrl(url)))validationError(`${field.replace(/_/g,' ')} contains an invalid image URL.`);
  for(const field of ['resort_gallery_json','amenities_json'])if((record[field]||[]).some(item=>!item||typeof item!=='object'||Array.isArray(item)||Object.values(item).some(value=>typeof value!=='string')))validationError(`${field.replace(/_/g,' ')} must contain valid items.`);
  for(const item of record.resort_gallery_json||[]){if(typeof item.src!=='string'||!item.src.trim()||item.src.length>5000000||!isSafeAssetUrl(item.src))validationError('Each gallery item needs a valid image URL.');if(typeof item.title!=='string'||item.title.length>191||typeof item.subtitle!=='string'||item.subtitle.length>1000)validationError('Gallery titles must be 191 characters or fewer and subtitles 1,000 characters or fewer.');}
  for(const item of record.amenities_json||[]){if(typeof item.title!=='string'||!item.title.trim()||item.title.length>191||typeof item.desc!=='string'||item.desc.length>1000||typeof item.icon!=='string'||!item.icon.trim()||item.icon.length>64)validationError('Each amenity needs a title, a valid icon name, and concise description.');}
 }
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
 const [rows]=await db.query('SELECT name,price,day_tour_price,night_tour_price,twenty_two_hour_price,max_guests FROM packages WHERE id=? AND is_active=1 LIMIT 1',[record.package_id]);
 if(!rows[0])throw httpError('The selected package is unavailable. Please choose another package.',422);
 record.package_name=rows[0].name;
 Object.assign(record,quoteBooking({packageRecord:rows[0],tourType:record.tour_type,guestCount:record.guest_count,paymentType:record.payment_type||'downpayment'}));
}
async function validateBookingSubmission(record,db=pool,proofToken=null,userId=null){
 if(!String(record.customer_name||'').trim()||!String(record.customer_email||'').trim()||!String(record.customer_phone||'').trim())throw httpError('Your name, email, and phone number are required to submit a booking.',422);
 record.customer_name=String(record.customer_name).trim();
  Object.assign(record,validateRequiredBookingPayment(record,{allowMissingDetails:true}));
 if(!String(record.payment_mode||'').trim()||!record.payment_qr_code_id)throw httpError('Choose a payment method before submitting your booking.',422);
  const [methods]=await db.query('SELECT id,label,account_name,account_number FROM payment_qr_codes WHERE id=? AND is_active=1 LIMIT 1',[record.payment_qr_code_id]);
 if(!methods[0])throw httpError('The selected payment method is unavailable. Refresh the page and choose another method.',422);
  record.payment_qr_code_label=methods[0].label;
  record.payment_mode=methods[0].label;
 if(!String(record.receipt_url||'').trim()||!await getUploadedReceiptBuffer(record.receipt_url,db))throw httpError('Upload a valid payment proof image before submitting your booking.',422);
 const claims=getPaymentProofUploadClaims(proofToken,{userId,fileUrl:record.receipt_url,secret:process.env.JWT_SECRET});
 if(!claims)throw httpError('Upload a new payment proof using your signed-in account before submitting this booking.',403);
  const ocr=claims.ocr||createEmptyReceiptOcr();
  const latestAllowedDate=getTodayManilaDate();
  const signals=validateReceiptSignals({
   ocr,
   requiredAmount:record.payment_amount_due,
   selectedMethod:methods[0].label,
   expectedAccountName:methods[0].account_name,
   expectedAccountNumber:methods[0].account_number,
   submittedPaymentNumber:record.payment_number,
   submittedReference:record.payment_reference_number,
   latestAllowedDate,
  });
  if(signals.notReceipt)throw httpError(signals.declineReason,422);
  if(signals.paymentNumber)record.payment_number=signals.paymentNumber;
  if(signals.paymentReference)record.payment_reference_number=signals.paymentReference;
  let duplicateReceipt=false;
  if(record.payment_proof_fingerprint){
   const [duplicates]=await db.query('SELECT id FROM bookings WHERE payment_proof_fingerprint=? AND id<>? LIMIT 1',[record.payment_proof_fingerprint,record.id]);
   duplicateReceipt=duplicates.length>0;
  }
  let duplicateReference=false;
  if(signals.paymentReference){
   const [duplicates]=await db.query('SELECT id FROM bookings WHERE LOWER(payment_reference_number)=LOWER(?) OR LOWER(payment_proof_ocr_reference)=LOWER(?) LIMIT 1',[signals.paymentReference,signals.paymentReference]);
   duplicateReference=duplicates.some((booking)=>booking.id!==record.id);
  }
  const selectedProvider=classifyPaymentProvider(methods[0].label);
  const successfulSignals=Number(ocr.confidence)>=MIN_CONFIDENT_VERIFICATION
   &&Boolean(signals.detectedProvider&&selectedProvider===signals.detectedProvider)
   &&signals.amount!==null&&Math.round(signals.amount*100)===Math.round(Number(record.payment_amount_due)*100)
   &&Boolean(signals.extractedPaymentNumber)&&Boolean(signals.extractedReference)&&Boolean(signals.date)
   &&signals.date===latestAllowedDate&&ocr.status==='successful';
  record.payment_proof_ocr_provider=signals.detectedProvider;
  record.payment_proof_ocr_amount=signals.amount;
  record.payment_proof_ocr_reference=signals.extractedReference;
  record.payment_proof_ocr_date=signals.date;
  record.payment_proof_ocr_confidence=signals.confidence;
  record.payment_status=signals.declineReason||duplicateReceipt||duplicateReference?'declined':'pending_verification';
  if(signals.declineReason||duplicateReceipt||duplicateReference){
   record.status='rejected';
   record.rejected_at=now();
   record.rejection_reason=signals.declineReason
    ||(duplicateReceipt?'This exact receipt image has already been submitted for another booking.':'This transaction reference has already been used for another booking.');
   record.payment_proof_review='auto_declined';
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
async function archiveRestoreAuthorization(req,res,next){try{if(!['PATCH','PUT'].includes(req.method)||!isAdmin(req.user))return next();if([req.user?.role,req.user?.app_role,req.user?._app_role].includes('super_admin'))return next();const entity=String(req.query.entity||''),rid=String(req.query.id||''),body=req.body||{};const restoreField={Booking:['status','pending'],Package:['is_active',true],PaymentQrCode:['is_active',true],FoundItem:['is_active',true],User:['disabled',false]}[entity];if(!restoreField||!rid||body[restoreField[0]]!==restoreField[1])return next();const cfg=MAP[entity];if(!cfg)return next();const [records]=await pool.query(`SELECT * FROM \`${cfg.table}\` WHERE id=? LIMIT 1`,[rid]);const record=records[0];if(!record)return next();const wasArchived=entity==='Booking'?['archived','cancelled'].includes(record.status):entity==='User'?Boolean(record.disabled):!Boolean(record.is_active);if(!wasArchived)return next();const userFilter=entity==='User'?" OR LOWER(action) LIKE '%disabled user account%'":'';const [owners]=await pool.query(`SELECT user_email FROM activity_logs WHERE entity_type=? AND entity_id=? AND (LOWER(action) LIKE '%archiv%'${userFilter}) ORDER BY created_date DESC LIMIT 1`,[entity,rid]);if(String(owners[0]?.user_email||'').toLowerCase()!==String(req.user.email||'').toLowerCase())return res.status(403).json({error:'You can only restore items that you archived.'});return next();}catch(error){return next(error);}}
async function enforceBookingNotice(req,res,next){try{const entity=String(req.query.entity||'');const body=req.body||{};const rebooking=body.rebooking_status==='requested';if(!['PATCH','PUT'].includes(req.method)||entity!=='Booking'||!rebooking||isAdmin(req.user))return next();if(!req.user)return res.status(401).json({error:'Not authenticated.'});const rid=String(req.query.id||'');if(!rid)return next();const [rows]=await pool.query('SELECT * FROM bookings WHERE id=? LIMIT 1',[rid]);const booking=rows[0];if(!booking||String(booking.customer_email).toLowerCase()!==String(req.user.email||'').toLowerCase())return next();if(!['pending','confirmed'].includes(booking.status)||(booking.rebooking_status||'none')==='pending'||Number(booking.rebooking_count||0)>=1)return res.status(409).json({error:'This booking is not eligible for another rebooking request.'});return next();}catch(error){return next(error);}}
async function handler(req,res,next){try{const entity=String(req.query.entity||'');const cfg=MAP[entity];if(!cfg)return res.status(404).json({error:`Unsupported entity: ${entity}`});const table=cfg.table;const fields=cfg.fields;const method=req.method;const admin=isAdmin(req.user);if(entity==='User'&&!admin)return res.status(403).json({error:'Forbidden.'});if(entity==='User'&&method==='POST')return res.status(403).json({error:'Use the administrator account creation flow.'});if(entity==='LostItemReport'&&!admin)return res.status(403).json({error:'Forbidden.'});if(entity==='ActivityLog'&&method!=='GET'&&!admin)return res.status(403).json({error:'Forbidden.'});if(entity==='User'&&!isSuperAdminUser(req.user)&&!['GET','PATCH','PUT'].includes(method))return res.status(403).json({error:'Forbidden.'});if(!admin&&['Booking','PaymentQrCode','SiteSetting'].includes(entity)&&method!=='GET')return res.status(403).json({error:'Forbidden.'});if(!admin&&entity==='Review'&&method!=='GET'&&method!=='POST')return res.status(403).json({error:'Forbidden.'});if(!admin&&['Package','ResortRule','UpcomingSchedule','FoundItem'].includes(entity)&&!['GET','POST'].includes(method))return res.status(403).json({error:'Forbidden.'});if(entity==='PaymentQrCode'&&admin&&['POST','PATCH','PUT'].includes(method))await ensurePaymentQrCodeImageCapacity();
if(method==='GET'){if(entity==='ActivityLog')return await listActivityLogs(req,res);if(entity==='Booking')await synchronizeBookingStatuses();const where=[],vals=[];if(entity==='Notification'){if(!req.user)return res.status(401).json({error:'Not authenticated.'});where.push('LOWER(user_email)=LOWER(?)');vals.push(req.user.email);}let filter={};try{filter=req.query.filter?JSON.parse(req.query.filter):{};}catch{}if(entity==='User'&&!isSuperAdminUser(req.user)){where.push('(role NOT IN (?,?) AND (app_role IS NULL OR app_role NOT IN (?,?)))');vals.push('admin','super_admin','admin','super_admin');if(filter.disabled===undefined)where.push('disabled=0');}for(const [f,v] of Object.entries(filter)){if(!fields.includes(f))continue;if(Array.isArray(v)&&v.length){where.push(`\`${f}\` IN (${v.map(()=>'?').join(',')})`);vals.push(...v.map(x=>serialize(cfg,f,x)));}else{where.push(`\`${f}\`=?`);vals.push(serialize(cfg,f,v));}}if(!admin&&['Package','PaymentQrCode','ResortRule','FoundItem'].includes(entity)){where.push('is_active=1');}if(!admin&&entity==='Review'){where.push('is_approved=1');}if(entity==='Booking'&&!admin&&req.user){where.push('LOWER(customer_email)=LOWER(?)');vals.push(req.user.email);}if(entity==='Booking'&&!req.user&&!filter.customer_email){where.push("status IN ('pending','confirmed','completed')");}let sql=`SELECT * FROM \`${table}\``;if(where.length)sql+=' WHERE '+where.join(' AND ');const sort=String(req.query.sort||'');if(sort){const desc=sort.startsWith('-'),sf=desc?sort.slice(1):sort;if(fields.includes(sf))sql+=` ORDER BY \`${sf}\` ${desc?'DESC':'ASC'}`;}if(/^\d+$/.test(String(req.query.limit||'')))sql+=` LIMIT ${Math.min(500,Number(req.query.limit))} OFFSET ${Math.max(0,/^\d+$/.test(String(req.query.offset||''))?Number(req.query.offset):0)}`;const [rows]=await pool.query(sql,vals);return res.json(rows.map(r=>{const item=deserialize(cfg,r);if(entity==='Booking'&&!admin&&(!req.user||String(item.customer_email||'').toLowerCase()!==String(req.user.email||'').toLowerCase()))return {id:item.id,package_id:item.package_id,package_name:item.package_name,tour_type:item.tour_type,booking_date:item.booking_date,guest_count:item.guest_count,status:item.status};return item;}));}
if(method==='POST'){if(!admin&&!['ActivityLog','Booking','Review'].includes(entity)&&!(entity==='FoundItem'&&req.user))return res.status(403).json({error:'Forbidden.'});if(!req.user&&['ActivityLog','Booking','Review','FoundItem'].includes(entity))return res.status(401).json({error:'Not authenticated.'});const p=req.body||{},n=now(),record={};for(const f of fields)if(Object.prototype.hasOwnProperty.call(p,f))record[f]=p[f];record.id=record.id||id(entity.toLowerCase());record.created_date=record.created_date||n;record.updated_date=n;if(entity==='ActivityLog'){record.user_email=req.user.email;record.user_name=req.user.full_name;record.actor_role=getActorRole(req.user);}if(entity==='Booking'){record.customer_email=req.user.email;record.booking_reference=record.booking_reference||`KI-${cryptoRandom(4)}`;record.status='pending';record.payment_status=record.receipt_url?'pending_verification':'unpaid';record.payment_proof_review=record.receipt_url?'needs_manual_review':null;record.payment_proof_fingerprint=null;if(record.receipt_url){const proofPath=uploadedReceiptPath(record.receipt_url);if(proofPath){record.payment_proof_fingerprint=createHash('sha256').update(fs.readFileSync(proofPath)).digest('hex');const [duplicates]=await pool.query('SELECT id FROM bookings WHERE payment_proof_fingerprint=? LIMIT 1',[record.payment_proof_fingerprint]);if(duplicates.length)record.payment_proof_review='duplicate_needs_review';}}}if(entity==='Review'&&!admin){const [bookings]=await pool.query('SELECT id,booking_reference,package_name,customer_name,customer_email,status FROM bookings WHERE id=? LIMIT 1',[record.booking_id]);const booking=bookings[0];if(!booking||String(booking.customer_email).toLowerCase()!==String(req.user.email).toLowerCase()||booking.status!=='completed')return res.status(403).json({error:'A review can only be submitted for your completed booking.'});Object.assign(record,{booking_reference:booking.booking_reference,package_name:booking.package_name,guest_name:booking.customer_name,guest_email:booking.customer_email});}if(entity==='FoundItem'&&!admin){delete record.is_active;delete record.status;record.found_by=req.user.full_name||req.user.email;record.status='unclaimed';record.is_active=false;}if(entity==='Package'){record.is_active=record.is_active!==false;record.price=Number(record.price||0);record.max_guests=Number(record.max_guests||1);}if(entity==='FoundItem'&&admin)record.status=record.status||'unclaimed';if(entity==='LostItemReport')record.status=record.status||'searching';await validate(entity,record);if(entity==='Booking')await validateBookingSubmission(record);const cols=[],qs=[],vals=[];for(const f of fields)if(Object.prototype.hasOwnProperty.call(record,f)){cols.push(`\`${f}\``);qs.push('?');vals.push(serialize(cfg,f,record[f]));}await pool.query(`INSERT INTO \`${table}\` (${cols.join(',')}) VALUES (${qs.join(',')})`,vals);if(entity==='Review'&&!admin)await pool.query('INSERT INTO activity_logs (id,created_date,updated_date,user_email,user_name,actor_role,action,entity_type,entity_id,details) VALUES (?,?,?,?,?,?,?,?,?,?)',[id('activitylog'),record.created_date,record.created_date,req.user.email||null,req.user.full_name||req.user.name||'Guest',getActorRole(req.user),'Submitted Review','Review',record.id,`Submitted a review for booking ${record.booking_reference||record.booking_id}.`]);const [r]=await pool.query(`SELECT * FROM \`${table}\` WHERE id=? LIMIT 1`,[record.id]);return res.status(201).json(deserialize(cfg,r[0]||record));}
if(['PATCH','PUT'].includes(method)){const rid=String(req.query.id||'');if(!rid)return res.status(422).json({error:'Missing entity id.'});const [existing]=await pool.query(`SELECT * FROM \`${table}\` WHERE id=? LIMIT 1`,[rid]);if(!existing[0])return res.status(404).json({error:'Record not found.'});if(entity==='User'){const userPatch=req.body||{};if('role' in userPatch||'app_role' in userPatch)return res.status(403).json({error:'User roles are fixed when the account is created.'});if(String(existing[0].id)===String(req.user.id)&&userPatch.disabled===true)return res.status(403).json({error:'You cannot archive your own admin account.'});if('disabled' in userPatch&&typeof userPatch.disabled!=='boolean')return res.status(422).json({error:'Account status must be true or false.'});if(!isSuperAdminUser(req.user)){if([existing[0].role,existing[0].app_role].includes('admin'))return res.status(403).json({error:'Only a super admin can manage admin accounts.'});if([existing[0].role,existing[0].app_role].includes('super_admin'))return res.status(403).json({error:'Only a super admin can manage super admin accounts.'});const allowedUserFields=new Set(['disabled']);if(Object.keys(userPatch).some(key=>!allowedUserFields.has(key)))return res.status(403).json({error:'Admins can only change account status.'});}}if(!admin){if(entity!=='Booking'||String(existing[0].customer_email).toLowerCase()!==String(req.user?.email||'').toLowerCase())return res.status(403).json({error:'Forbidden.'});const patch=req.body||{};const allowed=new Set(['status']);if(Object.keys(patch).some(key=>!allowed.has(key))||(patch.status&&patch.status!=='cancelled')||(patch.rebooking_status&&patch.rebooking_status!=='requested'))return res.status(403).json({error:'Forbidden.'});}const record={...existing[0],...(req.body||{}),updated_date:now()};const changedFields=new Set(Object.keys(req.body||{}));await validate(entity,record,rid,pool,changedFields);const updates=[],vals=[];for(const f of fields)if(f!=='id'&&Object.prototype.hasOwnProperty.call(req.body||{},f)){updates.push(`\`${f}\`=?`);vals.push(serialize(cfg,f,record[f]));}updates.push('updated_date=?');vals.push(record.updated_date,rid);await pool.query(`UPDATE \`${table}\` SET ${updates.join(',')} WHERE id=?`,vals);const [r]=await pool.query(`SELECT * FROM \`${table}\` WHERE id=? LIMIT 1`,[rid]);return res.json(deserialize(cfg,r[0]));}
if(method==='DELETE'){if(!admin)return res.status(403).json({error:'Forbidden.'});const rid=String(req.query.id||'');if(!rid)return res.status(422).json({error:'Missing entity id.'});await pool.query(`DELETE FROM \`${table}\` WHERE id=?`,[rid]);return res.json({success:true,id:rid});}return res.status(405).json({error:'Method not allowed.'});}catch(e){next(e);}}
function cryptoRandom(n){return require('crypto').randomBytes(n).toString('hex').toUpperCase().slice(0,8);}
function dateOnly(value){return value instanceof Date?value.toISOString().slice(0,10):String(value||'').slice(0,10);}
function uploadedReceiptPath(receiptUrl){try{const pathname=new URL(String(receiptUrl||''),'http://local.invalid').pathname;const match=pathname.match(/(?:^|\/)uploads\/(.+)$/i);if(!match)return null;const relativePath=decodeURIComponent(match[1]);for(const rootDirectory of [uploadsDir,bundledUploadsDir]){const root=path.resolve(rootDirectory)+path.sep;const candidate=path.resolve(rootDirectory,relativePath);if(candidate.startsWith(root)&&fs.existsSync(candidate)&&fs.statSync(candidate).isFile())return candidate;}return null;}catch{return null;}}
async function getUploadedReceiptBuffer(receiptUrl,db=pool){
 const filePath=uploadedReceiptPath(receiptUrl);
 if(filePath)return fs.readFileSync(filePath);
 try{
  const parsed=new URL(String(receiptUrl||''),'http://local.invalid');
  const match=parsed.pathname.match(/(?:^|\/)uploads\/(.+)$/i);
  if(!match)return null;
  const fileUrl=`/uploads/${decodeURIComponent(match[1])}`;
  const [rows]=await db.query('SELECT image_data FROM payment_proof_uploads WHERE file_url=? LIMIT 1',[fileUrl]);
  return rows[0]?.image_data||null;
 }catch{return null;}
}
async function notificationAction(req,res,next){if(String(req.query.entity||'')!=='Notification')return next();if(!req.user)return res.status(401).json({error:'Not authenticated.'});const email=String(req.user.email||'').toLowerCase();const action=String(req.query.action||'');if(req.method==='GET'&&action==='unread-count'){const [rows]=await pool.query('SELECT COUNT(*) AS count FROM notifications WHERE LOWER(user_email)=? AND is_read=0',[email]);return res.json({count:Number(rows[0]?.count||0)});}if(req.method==='PATCH'&&action==='mark-all-read'){const [result]=await pool.query('UPDATE notifications SET is_read=1 WHERE LOWER(user_email)=? AND is_read=0',[email]);return res.json({success:true,updated:Number(result.affectedRows||0)});}if(req.method==='PATCH'&&!action){const notificationId=String(req.query.id||'');if(!notificationId||Object.keys(req.body||{}).length!==1||req.body?.is_read!==true)return res.status(403).json({error:'Only marking your own notification as read is allowed.'});const [result]=await pool.query('UPDATE notifications SET is_read=1 WHERE id=? AND LOWER(user_email)=?',[notificationId,email]);if(!result.affectedRows)return res.status(404).json({error:'Notification not found.'});return res.json({id:notificationId,is_read:true});}if(req.method==='GET'&&!action)return next();return res.status(405).json({error:'Method not allowed.'});}
async function bookingEventNotifications(req,res,next){if(String(req.query.entity||'')!=='Booking'||!['POST','PATCH','PUT'].includes(req.method))return next();const isCreate=req.method==='POST';let before=null;if(!isCreate){const bookingId=String(req.query.id||'');if(bookingId){const [rows]=await pool.query('SELECT * FROM bookings WHERE id=? LIMIT 1',[bookingId]);before=rows[0]||null;}}const sendJson=res.json.bind(res);res.json=(payload)=>{const result=sendJson(payload);if(res.statusCode<400){const booking=isCreate?payload:(payload?.data||payload);if(booking?.id){void (async()=>{if(isCreate){const description=`${booking.booking_reference||booking.id} · ${booking.package_name||'Package'} · ${dateOnly(booking.booking_date)}`;await notifySafely({email:booking.customer_email,eventKey:`booking:${booking.id}:submitted`,title:'Your booking is pending confirmation',description,link:'/MyBookings',entityId:booking.id});await notifyBookingAdmins(booking);if(booking.payment_status==='pending_verification'){await notifyBookingAdmins(booking,{eventKey:`booking:${booking.id}:proof-submitted`,title:'Payment proof submitted',description:`${booking.booking_reference||booking.id} · ${booking.payment_mode||booking.payment_qr_code_label||'Payment method'} · Awaiting manual review.`});}return;}if(!before)return;const old=deserialize(MAP.Booking,before);if(old.status!==booking.status){await notifySafely({email:booking.customer_email,eventKey:`booking:${booking.id}:status:${old.status}:${booking.status}:${booking.updated_date}`,title:booking.status==='confirmed'?'Your booking has been confirmed':`Booking ${String(booking.status||'updated').replace(/_/g,' ')}`,description:`${booking.booking_reference||booking.id} · ${booking.package_name||'Booking'} on ${dateOnly(booking.booking_date)}.`,link:'/MyBookings',entityId:booking.id});}if(old.payment_status!==booking.payment_status){await notifySafely({email:booking.customer_email,eventKey:`booking:${booking.id}:payment:${old.payment_status}:${booking.payment_status}:${booking.updated_date}`,title:booking.payment_status==='paid'?'Payment verified':'Payment status updated',description:`${booking.booking_reference||booking.id} · ${String(booking.payment_status||'').replace(/_/g,' ')}.`,link:'/MyBookings',entityId:booking.id});}if(dateOnly(old.booking_date)!==dateOnly(booking.booking_date)){const summary=`${booking.booking_reference||booking.id} · Old date: ${dateOnly(old.booking_date)}. New date: ${dateOnly(booking.booking_date)}.`;await notifySafely({email:booking.customer_email,eventKey:`booking:${booking.id}:rescheduled:${dateOnly(booking.booking_date)}`,title:'Your booking schedule has been updated',description:summary,link:'/MyBookings',entityId:booking.id});await notifyBookingAdmins({...booking,customer_name:before.customer_name},{eventKey:`booking:${booking.id}:schedule:${dateOnly(booking.booking_date)}`,title:`Booking schedule updated`,description:summary});}if(old.rebooking_status!=='pending'&&booking.rebooking_status==='pending'){await notifyBookingAdmins({...booking,customer_name:before.customer_name},{eventKey:`booking:${booking.id}:reschedule-request:${dateOnly(booking.rebooking_requested_date||booking.booking_date)}`,title:'Reschedule request received',description:'A reschedule request was submitted. Review the booking in reservation management.'});}})().catch(error=>console.error('Booking notifications failed',{code:error.code,bookingId:booking.id}));}}return result;};return next();}
router.use(auth,enforceBookingNotice,archiveRestoreAuthorization,bookingCreationLock,blockPublicBookingEmailFilter,bookingEventNotifications,bookingAction,legalDocumentAction,notificationAction,handler); module.exports=router;

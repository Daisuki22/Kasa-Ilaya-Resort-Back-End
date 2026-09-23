const crypto=require('crypto');
const {v4:uuidv4}=require('uuid');
const {pool}=require('./config/database');
function id(prefix){return `${prefix}-${uuidv4()}`;}
function now(){return new Date().toISOString().slice(0,19).replace('T',' ');}
function sha256(v){return crypto.createHash('sha256').update(String(v)).digest('hex');}
function randomOtp(){return String(crypto.randomInt(0,1000000)).padStart(6,'0');}
function publicUser(u){if(!u)return null; return {id:u.id,created_date:u.created_date,updated_date:u.updated_date,email:u.email,full_name:u.full_name,birth_date:u.birth_date,phone:u.phone,profile_image_url:u.profile_image_url,disabled:!!u.disabled,is_verified:!!u.is_verified,app_id:u.app_id,is_service:!!u.is_service,_app_role:u.app_role,role:u.role};}
function cleanDate(v){return v ? new Date(v).toISOString() : null;}
async function findUserById(idv){const [r]=await pool.query('SELECT * FROM users WHERE id=? LIMIT 1',[idv]);return r[0]||null;}
async function findUserByEmail(email){const [r]=await pool.query('SELECT * FROM users WHERE email=? LIMIT 1',[String(email).trim().toLowerCase()]);return r[0]||null;}
async function isAdmin(user){return !!user && ['admin','super_admin'].includes(user.role||user.app_role);}
module.exports={id,now,sha256,randomOtp,publicUser,cleanDate,findUserById,findUserByEmail,isAdmin};

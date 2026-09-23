const nodemailer=require('nodemailer'); const config=require('../config/env');
let transporter=null;
function getTransporter(){if(!config.mail.enabled)return null;if(!transporter) transporter=nodemailer.createTransport({host:config.mail.host,port:config.mail.port,secure:config.mail.port===465,auth:{user:config.mail.user,pass:config.mail.pass}});return transporter;}
async function sendMail(to,subject,html,purpose='main'){const t=getTransporter(); if(!t)return {sent:false,disabled:true}; await t.sendMail({from:`${config.mail.fromName} <${config.mail.from}>`,to,subject,html});return {sent:true,purpose};}
module.exports={sendMail};

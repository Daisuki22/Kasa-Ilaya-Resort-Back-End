function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function renderBrandedEmail(subject, content) {
  const title = escapeHtml(subject || 'A message from Kasa Ilaya Resort');
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="margin:0;background:#f3f0e8;color:#263735;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${title}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f0e8;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e3ddd0;border-radius:14px;overflow:hidden;">
          <tr><td style="background:#0d5558;padding:24px 32px;color:#ffffff;">
            <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#c9e2dc;">Kasa Ilaya Resort</div>
            <div style="font-size:24px;line-height:1.3;font-weight:700;margin-top:8px;">${title}</div>
          </td></tr>
          <tr><td style="padding:28px 32px;font-size:15px;line-height:1.7;color:#354543;">${content || ''}</td></tr>
          <tr><td style="border-top:1px solid #e8e3da;padding:18px 32px;font-size:12px;line-height:1.6;color:#687774;">Kasa Ilaya Resort<br>We’re glad to have you with us.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

module.exports = { renderBrandedEmail };

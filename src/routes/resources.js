const express = require("express");
const { pool } = require("../config/database");
const { authenticate, requireRole } = require("../middleware/auth");
const { id } = require("../utils/id");

const router = express.Router();

const resources = {
  packages: {
    table: "packages",
    publicWhere: "is_active = 1",
    order: "created_date DESC"
  },
  reviews: {
    table: "reviews",
    publicWhere: "is_approved = 1",
    order: "created_date DESC"
  },
  resortRules: {
    table: "resort_rules",
    publicWhere: "is_active = 1",
    order: "sort_order ASC"
  },
  schedules: {
    table: "upcoming_schedules",
    publicWhere: "schedule_date >= CURDATE()",
    order: "schedule_date ASC, start_time ASC"
  },
  paymentQrCodes: {
    table: "payment_qr_codes",
    publicWhere: "is_active = 1",
    order: "display_order ASC"
  },
  siteSettings: {
    table: "site_settings",
    publicWhere: "1=1",
    order: "updated_date DESC"
  },
  bookings: {
    table: "bookings",
    publicWhere: "1=1",
    order: "created_date DESC"
  },
  inquiries: {
    table: "inquiries",
    publicWhere: "1=1",
    order: "updated_date DESC"
  },
  inquiryMessages: {
    table: "inquiry_messages",
    publicWhere: "1=1",
    order: "created_date ASC"
  },
  lostItemReports: {
    table: "lost_item_reports",
    publicWhere: "1=1",
    order: "created_date DESC"
  },
  foundItems: {
    table: "found_items",
    publicWhere: "is_active = 1",
    order: "created_date DESC"
  },
  upcomingSchedules: {
    table: "upcoming_schedules",
    publicWhere: "1=1",
    order: "schedule_date ASC, start_time ASC"
  },
  activityLogs: {
    table: "activity_logs",
    publicWhere: "1=1",
    order: "created_date DESC"
  }
};

function getResource(name) {
  return resources[name];
}

function columnsFromBody(body, forbidden = []) {
  const allowed = new Set([
    "booking_reference", "package_id", "package_name", "tour_type", "booking_date",
    "guest_count", "customer_name", "customer_email", "customer_phone", "special_requests",
    "total_amount", "reservation_fee_amount", "payment_qr_code_id", "payment_qr_code_label",
    "receipt_url", "status", "payment_status", "additional_fee_amount", "additional_fee_reason",
    "additional_fee_status", "rebooking_status", "rebooking_original_date",
    "rebooking_requested_date", "rebooking_reason", "rebooking_requested_at",
    "rebooking_resolved_at", "rebooking_resolution_note", "rebooking_count",
    "item_name", "description", "date_found", "location_found", "found_by", "image_url",
    "claimed_guest_name", "claimed_contact", "claimed_reservation_id", "proof_of_ownership",
    "released_by", "date_claimed", "is_active", "guest_name", "guest_email", "guest_phone",
    "subject", "user_id", "assigned_admin_id", "status", "guest_token_hash", "last_message_at",
    "last_message_preview", "inquiry_id", "sender_type", "sender_name", "sender_email",
    "sender_user_id", "message", "reservation_number", "item_lost", "date_lost", "contact_number",
    "email", "matched_item_id", "sent_at", "to_email", "body", "error_message", "provider",
    "name", "tour_type", "price", "day_tour_price", "night_tour_price", "twenty_two_hour_price",
    "max_guests", "inclusions", "gallery_images", "label", "account_name", "account_number",
    "instructions", "display_order", "title", "sort_order", "rating", "review_text",
    "booking_id", "booking_reference", "package_name", "site_name", "logo_url", "hero_image_url",
    "hero_badge_text", "hero_title_line1", "hero_title_line2", "hero_description",
    "body_font_style", "heading_font_style", "amenities_section_label", "amenities_section_title",
    "amenities_section_description", "amenities_json", "require_strong_password",
    "min_password_length", "session_timeout_minutes", "max_login_attempts", "lockout_minutes",
    "enable_login_notifications", "terms_title", "terms_summary", "terms_content",
    "resort_gallery_json", "packages_banner_url", "hero_images_json", "packages_banner_images_json",
    "schedule_date", "start_time", "end_time", "location", "created_by_name", "created_by_email",
    "action", "entity_type", "entity_id", "details"
  ]);

  const entries = Object.entries(body || {}).filter(([key, value]) =>
    allowed.has(key) && !forbidden.includes(key) && value !== undefined
  );

  return entries;
}

router.get("/:resource", async (req, res, next) => {
  try {
    const resource = getResource(req.params.resource);
    if (!resource) return res.status(404).json({ success: false, message: "Unknown resource." });

    const [rows] = await pool.query(
      `SELECT * FROM ${resource.table} WHERE ${resource.publicWhere} ORDER BY ${resource.order}`
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

router.get("/:resource/:id", async (req, res, next) => {
  try {
    const resource = getResource(req.params.resource);
    if (!resource) return res.status(404).json({ success: false, message: "Unknown resource." });

    const [rows] = await pool.query(
      `SELECT * FROM ${resource.table} WHERE id = ? LIMIT 1`,
      [req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Record not found." });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/:resource",
  authenticate,
  async (req, res, next) => {
    try {
      const resource = getResource(req.params.resource);
      if (!resource) return res.status(404).json({ success: false, message: "Unknown resource." });

      if (["activityLogs"].includes(req.params.resource)) {
        return res.status(403).json({ success: false, message: "This resource is not directly writable." });
      }

      const entries = columnsFromBody(req.body, ["id", "created_date", "updated_date"]);
      if (!entries.length) {
        return res.status(400).json({ success: false, message: "No writable fields supplied." });
      }

      const recordId = id();
      const keys = ["id", "created_date", "updated_date", ...entries.map(([key]) => key)];
      const values = [recordId, new Date(), new Date(), ...entries.map(([, value]) => value)];
      const placeholders = keys.map(() => "?").join(", ");

      await pool.query(
        `INSERT INTO ${resource.table} (${keys.join(", ")}) VALUES (${placeholders})`,
        values
      );

      const [rows] = await pool.query(
        `SELECT * FROM ${resource.table} WHERE id = ? LIMIT 1`,
        [recordId]
      );

      res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  "/:resource/:id",
  authenticate,
  async (req, res, next) => {
    try {
      const resource = getResource(req.params.resource);
      if (!resource) return res.status(404).json({ success: false, message: "Unknown resource." });

      const entries = columnsFromBody(req.body, ["id", "created_date", "updated_date"]);
      if (!entries.length) {
        return res.status(400).json({ success: false, message: "No writable fields supplied." });
      }

      const setClause = entries.map(([key]) => `${key} = ?`).join(", ");
      const values = entries.map(([, value]) => value);

      await pool.query(
        `UPDATE ${resource.table} SET ${setClause}, updated_date = NOW() WHERE id = ?`,
        [...values, req.params.id]
      );

      const [rows] = await pool.query(
        `SELECT * FROM ${resource.table} WHERE id = ? LIMIT 1`,
        [req.params.id]
      );

      if (!rows.length) {
        return res.status(404).json({ success: false, message: "Record not found." });
      }

      res.json({ success: true, data: rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  "/:resource/:id",
  authenticate,
  requireRole("admin", "super_admin"),
  async (req, res, next) => {
    try {
      const resource = getResource(req.params.resource);
      if (!resource) return res.status(404).json({ success: false, message: "Unknown resource." });

      const [result] = await pool.query(
        `DELETE FROM ${resource.table} WHERE id = ?`,
        [req.params.id]
      );

      if (!result.affectedRows) {
        return res.status(404).json({ success: false, message: "Record not found." });
      }

      res.json({ success: true, message: "Record deleted." });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;

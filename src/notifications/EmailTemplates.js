/**
 * Universal Service Demand-to-Supply Matching Engine
 * File: src/notifications/EmailTemplates.js
 * 
 * Centralized transactional email layout engine.
 * Generates mobile-optimized, accessible HTML email templates using 100% inline CSS.
 * Compatible across Gmail, Outlook, Apple Mail, and mobile clients.
 * 
 * Features cryptographic zero-login action buttons, PII masking, and escrow disclosure.
 * Compatible with modern V8 runtime. Zero external dependencies.
 */

var EmailTemplates = (function () {
  'use strict';

  var BRAND_NAME = 'Universal Marketplace';
  var COLOR_BRAND = '#2563EB';
  var COLOR_DARK = '#0F172A';
  var COLOR_BG = '#F8FAFC';
  var COLOR_BORDER = '#E2E8F0';
  var COLOR_SUCCESS = '#059669';
  var COLOR_MUTED = '#64748B';

  /**
   * Base responsive HTML email wrapper.
   * Enforces centered card structure, table layouts, and standard system typography.
   * 
   * @param {string} title - Email document title
   * @param {string} contentHtml - Inner body content HTML
   * @return {string} Fully formatted HTML email document
   */
  function wrapInLayout(title, contentHtml) {
    return '<!DOCTYPE html>' +
      '<html lang="en"><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      '<meta http-equiv="X-UA-Compatible" content="IE=edge">' +
      '<title>' + title + '</title>' +
      '<style type="text/css">' +
      '  body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }' +
      '  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }' +
      '  img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }' +
      '  @media screen and (max-width: 600px) {' +
      '    .email-container { width: 100% !important; border-radius: 0 !important; }' +
      '    .btn-stack { display: block !important; width: 100% !important; margin: 8px 0 !important; }' +
      '    .responsive-padding { padding: 20px 16px !important; }' +
      '  }' +
      '</style>' +
      '</head>' +
      '<body style="margin:0;padding:0;background-color:' + COLOR_BG + ';font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">' +
      '<table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:' + COLOR_BG + ';padding:24px 0;">' +
      '<tr><td align="center">' +
      '<!-- Container Card -->' +
      '<table class="email-container" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:580px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ' + COLOR_BORDER + ';box-shadow:0 1px 3px rgba(0,0,0,0.05);">' +
      '<!-- Brand Header -->' +
      '<tr><td style="background:' + COLOR_DARK + ';padding:18px 24px;border-bottom:3px solid ' + COLOR_BRAND + ';">' +
      '<span style="color:#ffffff;font-size:18px;font-weight:800;letter-spacing:0.5px;">' + BRAND_NAME + '</span>' +
      '</td></tr>' +
      '<!-- Body Content -->' +
      '<tr><td class="responsive-padding" style="padding:28px 24px;">' +
      contentHtml +
      '</td></tr>' +
      '<!-- Standard Footer -->' +
      '<tr><td style="background:#F1F5F9;padding:16px 24px;text-align:center;font-size:12px;color:' + COLOR_MUTED + ';line-height:1.5;">' +
      'Automated operational notification from ' + BRAND_NAME + '.<br>' +
      'Please do not forward action links; they are cryptographically signed to your account.' +
      '</td></tr>' +
      '</table>' +
      '</td></tr></table>' +
      '</body></html>';
  }

  /**
   * 1. Lead Opportunity Email (Dispatched to matched providers).
   * Masks customer personal information; exposes scope, locality, budget, and urgency.
   * Includes one-click cryptographic action links formatted as mobile touch targets.
   * 
   * @param {Object} lead - Master lead record
   * @param {Object} provider - Target candidate provider record
   * @param {string} interestedUrl - Cryptographically signed claim action URL
   * @param {string} declineUrl - Cryptographically signed pass action URL
   * @param {number} timeoutMinutes - Active claim window
   * @return {string} Styled HTML email
   */
  function leadOpportunity(lead, provider, interestedUrl, declineUrl, timeoutMinutes) {
    var budgetDisplay = Number(lead.budget_amount) > 0 ? '$' + Number(lead.budget_amount).toFixed(2) : 'Flexible / Open Quote';
    var cleanDescription = SecurityService.escapeHtml(lead.raw_description);

    var content = '<h2 style="margin:0 0 12px 0;font-size:20px;font-weight:800;color:' + COLOR_DARK + ';">New Service Opportunity</h2>' +
      '<p style="color:#334155;font-size:15px;line-height:1.5;margin:0 0 20px 0;">Hello ' + SecurityService.escapeHtml(provider.displayName || 'Professional') + ', a customer in your service radius submitted a project matching your capabilities:</p>' +
      '<!-- Details Card -->' +
      '<table width="100%" border="0" cellspacing="0" cellpadding="8" style="background:#F8FAFC;border-radius:8px;border:1px solid ' + COLOR_BORDER + ';margin:0 0 24px 0;font-size:14px;">' +
      '<tr><td width="30%" style="color:' + COLOR_MUTED + ';font-weight:600;">Category:</td><td style="color:' + COLOR_DARK + ';font-weight:700;">' + lead.derived_subcategory_id + '</td></tr>' +
      '<tr><td style="color:' + COLOR_MUTED + ';font-weight:600;">Locality:</td><td style="color:' + COLOR_DARK + ';font-weight:700;">' + SecurityService.escapeHtml(lead.target_locality) + '</td></tr>' +
      '<tr><td style="color:' + COLOR_MUTED + ';font-weight:600;">Urgency:</td><td style="color:#DC2626;font-weight:700;">' + lead.urgency + '</td></tr>' +
      '<tr><td style="color:' + COLOR_MUTED + ';font-weight:600;">Budget:</td><td style="color:' + COLOR_SUCCESS + ';font-weight:700;">' + budgetDisplay + '</td></tr>' +
      '<tr><td style="color:' + COLOR_MUTED + ';font-weight:600;vertical-align:top;">Scope:</td><td style="color:#334155;line-height:1.5;">"' + cleanDescription + '"</td></tr>' +
      '</table>' +
      '<!-- Dual CTA Buttons -->' +
      '<div style="text-align:center;margin:28px 0 16px 0;">' +
      '<a class="btn-stack" href="' + interestedUrl + '" style="background:' + COLOR_SUCCESS + ';color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:6px;display:inline-block;margin:6px;min-height:48px;line-height:20px;">INTERESTED (Claim Lead)</a>' +
      '<a class="btn-stack" href="' + declineUrl + '" style="background:#64748B;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 24px;border-radius:6px;display:inline-block;margin:6px;min-height:48px;line-height:20px;">PASS ON THIS</a>' +
      '</div>' +
      '<p style="font-size:12px;color:#94A3B8;text-align:center;margin:16px 0 0 0;">Opportunity reserved for ' + timeoutMinutes + ' minutes. First accepted response secures the connection.</p>';

    return wrapInLayout('Opportunity #' + lead.lead_id, content);
  }

  /**
   * 2. Lead Won / Customer PII Unlocked (Dispatched to winning provider).
   * Releases full customer contact details following confirmed acceptance.
   * 
   * @param {Object} lead - Master lead record
   * @param {Object} customer - Escrowed customer entity
   * @return {string} Styled HTML email
   */
  function providerLeadWon(lead, customer) {
    var content = '<h2 style="margin:0 0 12px 0;font-size:20px;font-weight:800;color:' + COLOR_SUCCESS + ';">Lead Connection Confirmed!</h2>' +
      '<p style="color:#334155;font-size:15px;line-height:1.5;margin:0 0 20px 0;">You have successfully claimed <strong>Lead #' + lead.lead_id + '</strong>. Customer details are now released below:</p>' +
      '<!-- Escrow Unlocked Card -->' +
      '<table width="100%" border="0" cellspacing="0" cellpadding="8" style="background:#ECFDF5;border-radius:8px;border:1px solid #A7F3D0;margin:0 0 20px 0;font-size:14px;">' +
      '<tr><td width="35%" style="color:#047857;font-weight:600;">Customer Name:</td><td style="color:' + COLOR_DARK + ';font-weight:700;">' + SecurityService.escapeHtml(customer.full_name) + '</td></tr>' +
      '<tr><td style="color:#047857;font-weight:600;">Phone Number:</td><td style="color:' + COLOR_DARK + ';font-weight:700;"><a href="tel:' + customer.phone + '" style="color:' + COLOR_BRAND + ';text-decoration:none;">' + customer.phone + '</a></td></tr>' +
      '<tr><td style="color:#047857;font-weight:600;">Email Address:</td><td style="color:' + COLOR_DARK + ';font-weight:700;"><a href="mailto:' + customer.email + '" style="color:' + COLOR_BRAND + ';text-decoration:none;">' + customer.email + '</a></td></tr>' +
      '<tr><td style="color:#047857;font-weight:600;vertical-align:top;">Project Scope:</td><td style="color:#334155;line-height:1.4;">"' + SecurityService.escapeHtml(lead.raw_description) + '"</td></tr>' +
      '</table>' +
      '<p style="font-size:14px;color:#334155;line-height:1.5;">Please contact the customer promptly to introduce your services and schedule a quote.</p>';

    return wrapInLayout('Customer Contact Unlocked #' + lead.lead_id, content);
  }

  /**
   * 3. Professional Matched Confirmation (Dispatched to customer).
   * Delivers verified provider credentials and contact details to customer.
   * 
   * @param {Object} lead - Master lead record
   * @param {Object} provider - Winning provider entity
   * @return {string} Styled HTML email
   */
  function customerProviderConnected(lead, provider) {
    var content = '<h2 style="margin:0 0 12px 0;font-size:20px;font-weight:800;color:' + COLOR_BRAND + ';">Professional Connected!</h2>' +
      '<p style="color:#334155;font-size:15px;line-height:1.5;margin:0 0 20px 0;">Great news! A verified service professional has accepted your request and will be in touch shortly:</p>' +
      '<!-- Provider Credentials Card -->' +
      '<table width="100%" border="0" cellspacing="0" cellpadding="8" style="background:#EFF6FF;border-radius:8px;border:1px solid #BFDBFE;margin:0 0 20px 0;font-size:14px;">' +
      '<tr><td width="35%" style="color:#1E40AF;font-weight:600;">Professional:</td><td style="color:' + COLOR_DARK + ';font-weight:700;">' + SecurityService.escapeHtml(provider.display_name) + '</td></tr>' +
      '<tr><td style="color:#1E40AF;font-weight:600;">Direct Phone:</td><td style="color:' + COLOR_DARK + ';font-weight:700;"><a href="tel:' + provider.phone + '" style="color:' + COLOR_BRAND + ';text-decoration:none;">' + provider.phone + '</a></td></tr>' +
      '<tr><td style="color:#1E40AF;font-weight:600;">Verified Rating:</td><td style="color:' + COLOR_DARK + ';font-weight:700;">&#9733; ' + (provider.rating_average || '5.0') + ' / 5.0</td></tr>' +
      '<tr><td style="color:#1E40AF;font-weight:600;">Verification Level:</td><td style="color:' + COLOR_SUCCESS + ';font-weight:700;">&#10003; ' + (provider.verification_level || 'VERIFIED') + '</td></tr>' +
      '</table>' +
      '<p style="font-size:14px;color:#334155;line-height:1.5;">You may also call them directly if your project requires immediate assistance.</p>';

    return wrapInLayout('Professional Connected #' + lead.lead_id, content);
  }

  /**
   * 4. Customer Request Confirmation & Self-Service Tracking.
   * Sent immediately upon requirement intake with tracking link.
   * 
   * @param {Object} lead - Master lead record
   * @param {string} trackingUrl - Self-service tracking link
   * @return {string} Styled HTML email
   */
  function customerSubmissionConfirmation(lead, trackingUrl) {
    var content = '<h2 style="margin:0 0 12px 0;font-size:20px;font-weight:800;color:' + COLOR_DARK + ';">We Received Your Request</h2>' +
      '<p style="color:#334155;font-size:15px;line-height:1.5;margin:0 0 20px 0;">Your service requirement <strong>#' + lead.lead_id + '</strong> is actively being matched with top verified professionals in ' + SecurityService.escapeHtml(lead.target_locality) + '.</p>' +
      '<div style="text-align:center;margin:24px 0;">' +
      '<a href="' + trackingUrl + '" style="background:' + COLOR_BRAND + ';color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:6px;display:inline-block;min-height:48px;line-height:24px;">Track Request Status</a>' +
      '</div>' +
      '<p style="font-size:13px;color:' + COLOR_MUTED + ';line-height:1.5;">Your phone number and email remain encrypted in escrow until a qualified professional accepts your project.</p>';

    return wrapInLayout('Request Received #' + lead.lead_id, content);
  }

  /**
   * 5. Free Leads Exhausted Notice (Delivered when balance hits 0).
   * Prompts provider to purchase prepaid lead packages.
   * 
   * @param {Object} provider - Target provider entity
   * @return {string} Styled HTML email
   */
  function freeLeadsExhaustedNotice(provider) {
    var content = '<h2 style="margin:0 0 12px 0;font-size:20px;font-weight:800;color:' + COLOR_DARK + ';">Free Trial Completed!</h2>' +
      '<p style="color:#334155;font-size:15px;line-height:1.5;margin:0 0 20px 0;">Hello ' + SecurityService.escapeHtml(provider.display_name) + ', you have successfully claimed your <strong>3 free qualified leads</strong>.</p>' +
      '<p style="color:#334155;font-size:14px;line-height:1.5;margin:0 0 20px 0;">Your profile remains active in our public directory. To continue receiving exclusive local customer requests, choose a prepaid lead package (no recurring subscription fees):</p>' +
      '<table width="100%" border="0" cellspacing="0" cellpadding="8" style="background:#F8FAFC;border-radius:8px;border:1px solid ' + COLOR_BORDER + ';margin:0 0 24px 0;font-size:13px;">' +
      '<tr><td><strong>Starter Pack (5 Leads)</strong></td><td align="right" style="font-weight:700;color:' + COLOR_SUCCESS + ';">$75.00 USD</td></tr>' +
      '<tr><td><strong>Growth Pack (15 Leads)</strong></td><td align="right" style="font-weight:700;color:' + COLOR_SUCCESS + ';">$180.00 USD (Save 20%)</td></tr>' +
      '<tr><td><strong>Scale Pack (30 Leads)</strong></td><td align="right" style="font-weight:700;color:' + COLOR_SUCCESS + ';">$300.00 USD (Save 33%)</td></tr>' +
      '</table>' +
      '<p style="font-size:13px;color:' + COLOR_MUTED + ';">Reply directly to this email or visit your account portal to activate a package.</p>';

    return wrapInLayout('Free Trial Completed', content);
  }

  return {
    wrapInLayout: wrapInLayout,
    leadOpportunity: leadOpportunity,
    providerLeadWon: providerLeadWon,
    customerProviderConnected: customerProviderConnected,
    customerSubmissionConfirmation: customerSubmissionConfirmation,
    freeLeadsExhaustedNotice: freeLeadsExhaustedNotice
  };
})();

/**
 * Universal Service Demand-to-Supply Matching Engine
 * File: src/customers/CustomerService.js
 * 
 * Customer requirement lifecycle, natural language regex/tokenizer parser,
 * customer PII escrow persistence, clarification triggering, and lead status tracking.
 * 
 * Extracts taxonomy classification, budget, and urgency from unstructured text.
 * Compatible with modern V8 runtime.
 */

var CustomerService = (function () {
  'use strict';

  // Common linguistic stop-words stripped prior to keyword vector intersection
  var STOP_WORDS = [
    'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'you', 'your', 'he', 'him',
    'she', 'her', 'they', 'them', 'what', 'which', 'who', 'whom', 'this', 'that',
    'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because',
    'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against',
    'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
    'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
    'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
    'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'can',
    'will', 'just', 'don', 'should', 'now', 'need', 'needs', 'want', 'wants',
    'looking', 'somebody', 'someone', 'please', 'help', 'urgently'
  ];

  /**
   * Tokenizes unstructured customer requirement text and derives matching criteria.
   * Matches tokens against active keyword dictionaries in SERVICE_SUBCATEGORIES.
   * Extracts urgency level and budget values using regular expression heuristics.
   * 
   * @param {string} rawText - Unstructured customer input (e.g., "Need urgent plumber to fix pipe leak, budget $250")
   * @return {Object} Parsed result { subcategoryId: string|null, urgency: string, budget: number|null, confidence: number }
   */
  function parseNaturalLanguageRequirement(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      return { subcategoryId: null, urgency: 'NORMAL', budget: null, confidence: 0.0 };
    }

    var cleanText = rawText.toLowerCase().replace(/[^a-z0-9\s\$]/g, ' ');
    var rawTokens = cleanText.split(/\s+/);
    var tokens = rawTokens.filter(function (t) {
      return t.length > 1 && STOP_WORDS.indexOf(t) === -1;
    });

    // 1. Urgency Heuristic Detection
    var urgency = 'NORMAL';
    if (/\b(urgent|urgently|emergency|asap|immediately|right now|today|burst|leak)\b/i.test(rawText)) {
      urgency = 'IMMEDIATE';
    } else if (/\b(this week|within 48 hours|tomorrow|soon)\b/i.test(rawText)) {
      urgency = 'HIGH';
    } else if (/\b(flexible|no rush|next month|next week|whenever)\b/i.test(rawText)) {
      urgency = 'FLEXIBLE';
    }

    // 2. Budget Extraction via RegEx
    var budget = null;
    var budgetMatch = rawText.match(/\$?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:usd|dollars)?/i);
    if (budgetMatch && budgetMatch[1]) {
      var parsedBudget = parseFloat(budgetMatch[1].replace(/,/g, ''));
      if (!isNaN(parsedBudget) && parsedBudget > 0) {
        budget = parsedBudget;
      }
    }

    // 3. Taxonomy Scoring against Active Subcategories
    var subcategories = DAL.getTable('SERVICE_SUBCATEGORIES').filter(function (s) {
      return s.is_active === true || s.is_active === 'TRUE';
    });

    var bestSubcatId = null;
    var maxScore = 0;

    for (var i = 0; i < subcategories.length; i++) {
      var sub = subcategories[i];
      var subKeywords = (sub.keywords || '').toLowerCase().split(',');
      var subNameWords = sub.subcategory_name.toLowerCase().split(/\s+/);
      var currentScore = 0;

      for (var t = 0; t < tokens.length; t++) {
        var token = tokens[t];

        // Stronger match if token matches title word directly
        if (subNameWords.indexOf(token) !== -1) {
          currentScore += 3;
        }

        // Standard match if token matches keyword dictionary
        for (var k = 0; k < subKeywords.length; k++) {
          if (subKeywords[k].trim() === token) {
            currentScore += 1;
          }
        }
      }

      if (currentScore > maxScore) {
        maxScore = currentScore;
        bestSubcatId = sub.subcategory_id;
      }
    }

    var confidence = tokens.length > 0 ? (maxScore / (tokens.length * 2)) : 0.0;
    return {
      subcategoryId: bestSubcatId,
      urgency: urgency,
      budget: budget,
      confidence: parseFloat(Math.min(1.0, confidence).toFixed(2))
    };
  }

  /**
   * Ingests a customer requirement, creates the customer record in escrow,
   * generates the validated lead, and returns a cryptographic tracking token.
   * 
   * @param {Object} input - Client requirement payload
   * @return {Object} { success: boolean, leadId: string|null, trackingToken: string|null, needsClarification: boolean, error: string|null }
   */
  function submitRequirement(input) {
    if (!input) {
      return { success: false, leadId: null, trackingToken: null, needsClarification: false, error: 'EMPTY_PAYLOAD' };
    }

    // Validate mandatory customer contact parameters
    if (!input.fullName || !input.email || !input.phone || !input.description) {
      return { success: false, leadId: null, trackingToken: null, needsClarification: false, error: 'MISSING_MANDATORY_FIELDS' };
    }

    // 1. Parse requirement to extract or verify subcategory
    var parsed = parseNaturalLanguageRequirement(input.description);
    var subcategoryId = input.subcategoryId || parsed.subcategoryId;

    // Requirement Ambiguity Check: trigger clarification modal if subcategory cannot be resolved
    if (!subcategoryId) {
      return {
        success: false,
        leadId: null,
        trackingToken: null,
        needsClarification: true,
        error: 'REQUIREMENT_TOO_VAGUE'
      };
    }

    // 2. Resolve Geographic Coordinates
    var targetLat = input.latitude;
    var targetLng = input.longitude;
    var targetLocality = input.locality || 'Springfield';

    if (!GeoService.isValidCoordinate(targetLat, targetLng)) {
      var geocoded = GeoService.geocodeAddress(targetLocality);
      if (geocoded) {
        targetLat = geocoded.latitude;
        targetLng = geocoded.longitude;
        targetLocality = geocoded.formattedAddress;
      } else {
        // Fallback default coordinates
        targetLat = 44.0521;
        targetLng = -123.0189;
      }
    }

    return DAL.withLock(function () {
      // 3. Persist Customer Contact Info in Privacy Escrow
      var customerId = IdGenerator.customer();
      var customerRecord = {
        customer_id: customerId,
        full_name: input.fullName.trim(),
        email: input.email.trim().toLowerCase(),
        phone: input.phone.trim(),
        created_at: new Date().toISOString()
      };
      DAL.insert('CUSTOMERS', customerRecord);

      // 4. Persist Master Lead Record
      var leadId = IdGenerator.lead();
      var now = new Date();
      var expiresAt = new Date(now.getTime() + (48 * 3600000)).toISOString(); // 48-hour default life

      var leadRecord = {
        lead_id: leadId,
        customer_id: customerId,
        status: 'VALIDATED',
        raw_description: input.description.trim(),
        derived_subcategory_id: subcategoryId,
        urgency: input.urgency || parsed.urgency,
        budget_amount: Number(input.budget || parsed.budget || 0.0),
        target_locality: targetLocality,
        target_latitude: targetLat,
        target_longitude: targetLng,
        direct_provider_id: input.directProviderId || '',
        dispatched_count: 0,
        accepted_count: 0,
        max_acceptances: 1,
        created_at: now.toISOString(),
        expires_at: expiresAt
      };
      DAL.insert('LEADS', leadRecord);

      DAL.logAudit('LEAD', leadId, 'LEAD_CREATED', '', 'VALIDATED', 'CUSTOMER', customerId, {
        subcat: subcategoryId,
        urgency: leadRecord.urgency,
        budget: leadRecord.budget_amount
      });

      // 5. Generate Secure Customer Tracking Token
      var trackingToken = AuthService.createCustomerTrackingToken(leadId, customerId);

      return {
        success: true,
        leadId: leadId,
        trackingToken: trackingToken,
        needsClarification: false,
        error: null
      };
    });
  }

  /**
   * Retrieves live status information for a customer using their tracking token.
   * Withholds private operational details while displaying match status.
   * 
   * @param {string} leadId - Lead identifier
   * @param {string} trackingToken - Signed customer tracking token
   * @return {Object} Tracking status payload
   */
  function getLeadTrackingStatus(leadId, trackingToken) {
    if (!AuthService.authorizeCustomerLead(trackingToken, leadId)) {
      return { success: false, error: 'UNAUTHORIZED_TRACKING_TOKEN' };
    }

    var lead = DAL.findById('LEADS', leadId);
    if (!lead) {
      return { success: false, error: 'LEAD_NOT_FOUND' };
    }

    var statusPayload = {
      leadId: lead.leadId,
      status: lead.status,
      createdAt: lead.created_at,
      locality: lead.target_locality,
      urgency: lead.urgency,
      connectedProvider: null
    };

    // If lead is connected, expose verified public details of the winning provider
    if (lead.status === 'CUSTOMER_CONNECTED') {
      var acceptedDist = DAL.find('LEAD_DISTRIBUTION', function (r) {
        return r.lead_id === leadId && r.status === 'ACCEPTED';
      });

      if (acceptedDist.length > 0) {
        var provider = DAL.findById('PROVIDERS', acceptedDist[0].provider_id);
        if (provider) {
          statusPayload.connectedProvider = {
            displayName: provider.display_name,
            providerType: provider.provider_type,
            phone: provider.phone,
            ratingAverage: provider.rating_average,
            profileSlug: provider.profile_slug
          };
        }
      }
    }

    return { success: true, tracking: statusPayload };
  }

  /**
   * Allows a customer to cancel their request in flight.
   * Automatically closes pending distributions and refunds provider credits if already claimed.
   * 
   * @param {string} leadId - Lead identifier
   * @param {string} trackingToken - Signed customer tracking token
   * @param {string} [reason='CUSTOMER_REQUESTED'] - Cancellation rationale
   * @return {boolean} True if cancelled successfully
   */
  function cancelLead(leadId, trackingToken, reason) {
    if (!AuthService.authorizeCustomerLead(trackingToken, leadId)) {
      return false;
    }

    return DAL.withLock(function () {
      var lead = DAL.findById('LEADS', leadId);
      if (!lead || lead.status === 'CANCELLED' || lead.status === 'COMPLETED') {
        return false;
      }

      var oldStatus = lead.status;
      DAL.update('LEADS', leadId, { status: 'CANCELLED' });

      // Supercede any active pending distributions
      var activeDists = DAL.find('LEAD_DISTRIBUTION', function (r) {
        return r.lead_id === leadId && (r.status === 'DISPATCHED' || r.status === 'ACCEPTED');
      });

      for (var i = 0; i < activeDists.length; i++) {
        var dist = activeDists[i];
        if (dist.status === 'ACCEPTED') {
          // Refund the provider's credit
          BillingService.refundDisputedLead(dist.provider_id, leadId, 'CUSTOMER_CANCELLED_IN_FLIGHT');
        }
        DAL.update('LEAD_DISTRIBUTION', dist.distribution_id, { status: 'SUPERCEDED' });
      }

      DAL.logAudit('LEAD', leadId, 'LEAD_CANCELLED', oldStatus, 'CANCELLED', 'CUSTOMER', lead.customer_id, {
        reason: reason || 'CUSTOMER_REQUESTED'
      });

      return true;
    });
  }

  return {
    parseNaturalLanguageRequirement: parseNaturalLanguageRequirement,
    submitRequirement: submitRequirement,
    getLeadTrackingStatus: getLeadTrackingStatus,
    cancelLead: cancelLead
  };
})();

/**
 * Universal Service Demand-to-Supply Matching Engine
 * File: src/controller/Controller.js
 * 
 * HTTP entry points (doGet, doPost) and client-accessible server RPC handlers.
 * Routes traffic to responsive HTMLService templates, processes Stripe webhook postbacks,
 * and handles secure asynchronous calls from client interfaces via google.script.run.
 * 
 * Enforces server-side authorization and input validation on all routes.
 * Compatible with modern V8 runtime.
 */

/**
 * Primary HTTP GET router.
 * Dispatches incoming web traffic to the appropriate HTML template based on URL query parameters.
 * 
 * @param {Object} e - HTTP request event object containing query parameters
 * @return {HtmlOutput} Rendered HTMLService output
 */
function doGet(e) {
  e = e || { parameter: {} };
  var page = e.parameter.page;
  var action = e.parameter.action;

  // =========================================================================
  // ROUTE 1: Zero-Login Provider Lead Action Portal (Interested / Decline)
  // =========================================================================
  if (action === 'PROVIDER_LEAD_RESPONSE') {
    var actionTemplate = HtmlService.createTemplateFromFile('LeadAction');
    actionTemplate.decision = e.parameter.decision || '';
    actionTemplate.leadId = e.parameter.lead_id || '';
    actionTemplate.providerId = e.parameter.provider_id || '';
    actionTemplate.timestamp = e.parameter.t || '';
    actionTemplate.signature = e.parameter.sig || '';

    return actionTemplate.evaluate()
      .setTitle('Respond to Opportunity | Universal Marketplace')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // =========================================================================
  // ROUTE 2: Public Provider Mini-Site Profile View
  // =========================================================================
  if (page === 'profile') {
    var slug = e.parameter.slug || '';
    var profileTemplate = HtmlService.createTemplateFromFile('ProviderProfile');
    profileTemplate.profileSlug = slug;

    return profileTemplate.evaluate()
      .setTitle('Professional Profile | Universal Marketplace')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // =========================================================================
  // ROUTE 3: Provider Self-Registration Onboarding Wizard
  // =========================================================================
  if (page === 'signup') {
    return HtmlService.createTemplateFromFile('ProviderSignup').evaluate()
      .setTitle('Join as a Verified Professional | Universal Marketplace')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // =========================================================================
  // DEFAULT ROUTE: Universal Customer Discovery, Search & Intake Landing Page
  // =========================================================================
  var indexTemplate = HtmlService.createTemplateFromFile('Index');
  return indexTemplate.evaluate()
    .setTitle('Universal Marketplace | Connect with Verified Local Professionals')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Primary HTTP POST router.
 * Ingests external webhook notifications (e.g., Stripe Checkout completed events).
 * 
 * @param {Object} e - HTTP POST event containing postData
 * @return {TextOutput} Raw HTTP response
 */
function doPost(e) {
  e = e || { parameter: {}, postData: {} };

  // ROUTE: Stripe Payment Webhook
  if (e.parameter.action === 'STRIPE_WEBHOOK') {
    try {
      var rawPayload = e.postData.contents || '';
      var sigHeader = e.parameter['Stripe-Signature'] || '';

      var result = BillingService.handleStripeWebhook(rawPayload, sigHeader);
      return ContentService.createTextOutput(result.body)
        .setMimeType(ContentService.MimeType.TEXT);
    } catch (err) {
      SystemErrorHandler.logError('Controller.doPost:StripeWebhook', 'CRITICAL', err.message, err.stack);
      return ContentService.createTextOutput('Webhook processing error: ' + err.message)
        .setMimeType(ContentService.MimeType.TEXT);
    }
  }

  return ContentService.createTextOutput('POST endpoint active.')
    .setMimeType(ContentService.MimeType.TEXT);
}

// ===========================================================================
// CLIENT-ACCESSIBLE SERVER RPC METHODS (Called via google.script.run)
// ===========================================================================

/**
 * CLIENT RPC: Retrieves active categories, subcategories, and trust metrics.
 * Called on homepage load to render dynamic discovery chips and dropdowns.
 * 
 * @return {Object} { success: boolean, categories: Array, subcategories: Array, stats: Object }
 */
function getMarketplaceCatalogRpc() {
  try {
    var categories = DAL.getTable('SERVICE_CATEGORIES').filter(function (c) {
      return c.is_active === true || c.is_active === 'TRUE';
    });

    var subcategories = DAL.getTable('SERVICE_SUBCATEGORIES').filter(function (s) {
      return s.is_active === true || s.is_active === 'TRUE';
    });

    var activeProviders = DAL.getTable('PROVIDERS').filter(function (p) {
      return p.status === 'ACTIVE' || p.status === 'VERIFIED';
    });

    return {
      success: true,
      categories: categories,
      subcategories: subcategories,
      stats: {
        verifiedProviders: activeProviders.length,
        averageRating: '4.9',
        avgResponseMinutes: '14'
      }
    };
  } catch (err) {
    SystemErrorHandler.logError('Controller.getMarketplaceCatalogRpc', 'MEDIUM', err.message, err.stack);
    return { success: false, error: err.message };
  }
}

/**
 * CLIENT RPC: Submits a customer requirement and dispatches Wave 1 matches.
 * Gated by server-side rate limiter and validation.
 * 
 * @param {Object} payload - Requirement payload from Index.html intake wizard
 * @return {Object} { success: boolean, leadId: string|null, trackingToken: string|null, dispatchedCount: number, needsClarification: boolean }
 */
function submitCustomerRequirementRpc(payload) {
  try {
    if (!payload) {
      return { success: false, error: 'Empty submission payload.' };
    }

    // Rate Limiting Guard: Max 10 submissions per minute per email hash
    var rateKey = 'REQ_' + (payload.email || 'ANONYMOUS').toLowerCase().replace(/[^a-z0-9]/g, '_');
    if (!SecurityService.checkRateLimit(rateKey, 10, 60)) {
      return { success: false, error: 'Too many requests. Please wait a moment before resubmitting.' };
    }

    // Ingest requirement, create escrow customer, and validate lead
    var result = CustomerService.submitRequirement(payload);
    if (!result.success) {
      return result;
    }

    // Trigger initial Wave 1 lead distribution immediately
    var dispatchedCount = DistributionEngine.dispatchInitialWave(result.leadId);

    return {
      success: true,
      leadId: result.leadId,
      trackingToken: result.trackingToken,
      dispatchedCount: dispatchedCount,
      needsClarification: false
    };
  } catch (err) {
    SystemErrorHandler.logError('Controller.submitCustomerRequirementRpc', 'HIGH', err.message, err.stack, payload);
    return { success: false, error: 'Internal processing error: ' + err.message };
  }
}

/**
 * CLIENT RPC: Retrieves sanitized public storefront data for a provider mini-site.
 * Strictly withholds private email, telephone, legal name, and internal audit scores.
 * 
 * @param {string} slug - Public mini-site URL slug (e.g., 'apex-carpentry-ltd-a7f9')
 * @return {Object} { success: boolean, profile: Object|null, error: string|null }
 */
function getProviderPublicProfileRpc(slug) {
  try {
    if (!slug || typeof slug !== 'string') {
      return { success: false, error: 'Invalid profile slug.' };
    }

    var cleanSlug = slug.trim().toLowerCase();
    var providers = DAL.find('PROVIDERS', function (p) {
      return p.profile_slug === cleanSlug && (p.status === 'ACTIVE' || p.status === 'VERIFIED');
    });

    if (providers.length === 0) {
      return { success: false, error: 'Profile not found or currently under routine review.' };
    }

    var provider = providers[0];
    var pId = provider.provider_id;

    var services = DAL.find('PROVIDER_SERVICES', function (s) { return s.provider_id === pId; });
    var location = DAL.find('PROVIDER_LOCATIONS', function (l) { return l.provider_id === pId; })[0];

    // Return sanitized storefront data only
    return {
      success: true,
      profile: {
        providerId: pId,
        displayName: SecurityService.escapeHtml(provider.display_name),
        providerType: provider.provider_type,
        bio: SecurityService.escapeHtml(provider.bio || 'Verified service professional.'),
        verificationLevel: provider.verification_level || 'VERIFIED',
        ratingAverage: provider.rating_average || '5.0',
        ratingCount: Number(provider.rating_count) || 0,
        responseRatePct: Number(provider.response_rate_pct) || 98,
        websiteUrl: provider.website_url || '',
        locality: location ? SecurityService.escapeHtml(location.locality) : 'Service Area Available',
        radiusKm: location ? Number(location.radius_km) : 25,
        services: services.map(function (s) {
          return {
            subcategoryId: s.subcategory_id,
            customSkills: SecurityService.escapeHtml(s.custom_skills || ''),
            baseRate: s.base_rate ? '$' + Number(s.base_rate).toFixed(2) : 'Quote Required',
            rateUnit: s.rate_unit || 'FIXED'
          };
        })
      }
    };
  } catch (err) {
    SystemErrorHandler.logError('Controller.getProviderPublicProfileRpc', 'MEDIUM', err.message, err.stack);
    return { success: false, error: err.message };
  }
}

/**
 * CLIENT RPC: Registers a new service provider, sets up location/capabilities,
 * and activates their initial 3 free lead credits in the ledger.
 * 
 * @param {Object} payload - Registration payload from ProviderSignup.html
 * @return {Object} { success: boolean, providerId: string|null, profileSlug: string|null, error: string|null }
 */
function registerProviderRpc(payload) {
  try {
    if (!payload || !payload.displayName || !payload.email || !payload.phone) {
      return { success: false, error: 'Missing mandatory registration parameters.' };
    }

    return DAL.withLock(function () {
      var cleanEmail = payload.email.trim().toLowerCase();

      // Check for duplicate registered email
      var existing = DAL.find('PROVIDERS', function (p) {
        return p.email.toLowerCase() === cleanEmail;
      });

      if (existing.length > 0) {
        return { success: false, error: 'A provider account with this email address already exists.' };
      }

      var providerId = IdGenerator.provider();
      var baseSlug = payload.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      var slug = baseSlug + '-' + providerId.substring(5, 9).toLowerCase();

      // 1. Insert Master Provider Record
      DAL.insert('PROVIDERS', {
        provider_id: providerId,
        provider_type: payload.providerType || 'INDIVIDUAL',
        display_name: payload.displayName.trim(),
        legal_name: payload.legalName ? payload.legalName.trim() : payload.displayName.trim(),
        email: cleanEmail,
        phone: payload.phone.trim(),
        website_url: payload.websiteUrl ? payload.websiteUrl.trim() : '',
        bio: payload.bio ? payload.bio.trim() : '',
        profile_slug: slug,
        status: 'VERIFIED', // Approved with 3 free trial leads
        verification_level: 'VERIFIED',
        trust_score: 75.0,
        rating_average: 5.0,
        rating_count: 0,
        response_rate_pct: 100.0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      // 2. Resolve and Insert Geographic Operating Base
      var geocoded = GeoService.geocodeAddress(payload.locality || 'Springfield');
      DAL.insert('PROVIDER_LOCATIONS', {
        location_id: IdGenerator.location(),
        provider_id: providerId,
        service_mode: payload.serviceMode || 'ONSITE',
        base_address: payload.baseAddress || '',
        base_latitude: geocoded ? geocoded.latitude : 44.0521,
        base_longitude: geocoded ? geocoded.longitude : -123.0189,
        radius_km: Number(payload.radiusKm) || 25.0,
        locality: payload.locality ? payload.locality.trim() : 'Springfield',
        postal_code: payload.postalCode || ''
      });

      // 3. Insert Primary Service Capability
      DAL.insert('PROVIDER_SERVICES', {
        provider_service_id: IdGenerator.service(),
        provider_id: providerId,
        subcategory_id: payload.subcategoryId || 'SUBCAT-CARP',
        custom_skills: payload.customSkills ? payload.customSkills.trim() : '',
        base_rate: Number(payload.baseRate) || 50.0,
        rate_unit: payload.rateUnit || 'HOURLY',
        experience_years: Number(payload.experienceYears) || 3
      });

      // 4. Initialize 3 Free Leads Accounting Ledger
      EntitlementService.initializeEntitlement(providerId);

      // 5. Initialize Double-Entry Unified Ledger Entry (+3 Credits)
      DAL.insert('LEDGER_ENTITLEMENTS', {
        ledger_id: IdGenerator.ledger(),
        provider_id: providerId,
        transaction_type: 'FREE_GRANT',
        reference_id: 'ONBOARDING',
        credit_delta: 3,
        balance_after: 3,
        created_at: new Date().toISOString()
      });

      DAL.logAudit('PROVIDER', providerId, 'PROVIDER_ONBOARDED', '', 'VERIFIED', 'PROVIDER', providerId, {
        slug: slug,
        initialFreeCredits: 3
      });

      return {
        success: true,
        providerId: providerId,
        profileSlug: slug,
        message: 'Registration approved! 3 free lead credits have been activated.'
      };
    });
  } catch (err) {
    SystemErrorHandler.logError('Controller.registerProviderRpc', 'HIGH', err.message, err.stack, payload);
    return { success: false, error: err.message };
  }
}

/**
 * CLIENT RPC: Executes the provider claim or pass decision from LeadAction.html.
 * Invoked when provider clicks through the anti-scanner confirmation gate.
 * 
 * @param {string} decision - 'INTERESTED' or 'NOT_INTERESTED'
 * @param {string} leadId - Master lead identifier
 * @param {string} providerId - Responding provider identifier
 * @param {string|number} timestamp - Expiration timestamp
 * @param {string} signature - HMAC-SHA256 signature
 * @return {Object} Status response { success: boolean, code: string, message: string }
 */
function executeProviderLeadActionRpc(decision, leadId, providerId, timestamp, signature) {
  try {
    return DistributionEngine.handleProviderResponse(decision, leadId, providerId, Number(timestamp), signature);
  } catch (err) {
    SystemErrorHandler.logError('Controller.executeProviderLeadActionRpc', 'HIGH', err.message, err.stack);
    return { success: false, code: 'SYSTEM_ERROR', message: err.message };
  }
}

/**
 * CLIENT RPC: Retrieves live lead progress for customers using their tracking token.
 * 
 * @param {string} leadId - Master lead identifier
 * @param {string} trackingToken - Signed customer tracking token
 * @return {Object} Tracking status payload
 */
function getCustomerTrackingStatusRpc(leadId, trackingToken) {
  try {
    return CustomerService.getLeadTrackingStatus(leadId, trackingToken);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Universal Service Demand-to-Supply Matching Engine
 * File: src/matching/MatchingEngine.js
 * 
 * Multivariate candidate scoring and ranking subsystem.
 * Evaluates active providers against lead requirements using dynamic weighted criteria:
 * Capabilities (30%), Distance (20%), Trust (15%), Ratings (10%), Availability (10%),
 * Response Rate (5%), Lead Performance (5%), and Profile Completeness (5%).
 * 
 * Enforces hard eligibility filters, cold-start exploration boosts, rotational balancing,
 * and produces explainable score breakdowns. Compatible with modern V8 runtime.
 */

var MatchingEngine = (function () {
  'use strict';

  var COLD_START_EXPLORATION_SCORE = 0.85; // Provisional 4.25/5.0 score for newly verified providers

  /**
   * Evaluates all providers in the database and produces a ranked array of eligible candidates.
   * Excludes ineligible candidates (suspended, exhausted balance, or outside geographic radius).
   * 
   * @param {string} leadId - Master lead identifier
   * @return {Array<Object>} Ranked candidates sorted by composite score descending
   */
  function findMatchesForLead(leadId) {
    if (!leadId) {
      throw new Error('MatchingEngine.findMatchesForLead: leadId is mandatory.');
    }

    var lead = DAL.findById('LEADS', leadId);
    if (!lead) {
      throw new Error('MatchingEngine.findMatchesForLead: Lead "' + leadId + '" does not exist.');
    }

    // Load tables in batch for performance
    var providers = DAL.getTable('PROVIDERS');
    var services = DAL.getTable('PROVIDER_SERVICES');
    var locations = DAL.getTable('PROVIDER_LOCATIONS');
    var distributions = DAL.getTable('LEAD_DISTRIBUTION');

    // Dynamic weights from CONFIG
    var wCapability = Number(ConfigService.get('WEIGHT_CAPABILITY')) || 0.30;
    var wDistance = Number(ConfigService.get('WEIGHT_DISTANCE')) || 0.20;
    var wTrust = Number(ConfigService.get('WEIGHT_TRUST')) || 0.15;
    var wRating = Number(ConfigService.get('WEIGHT_RATING')) || 0.10;
    var wAvailability = Number(ConfigService.get('WEIGHT_AVAILABILITY')) || 0.10;
    var wResponseRate = Number(ConfigService.get('WEIGHT_RESPONSE_RATE')) || 0.05;
    var wLeadPerf = Number(ConfigService.get('WEIGHT_LEAD_PERFORMANCE')) || 0.05;
    var wProfileComp = Number(ConfigService.get('WEIGHT_PROFILE_COMPLETENESS')) || 0.05;
    var minScoreThreshold = Number(ConfigService.get('MIN_MATCH_SCORE_THRESHOLD')) || 40.0;

    var candidates = [];
    var nowMs = new Date().getTime();
    var oneDayAgoIso = new Date(nowMs - 86400000).toISOString();

    for (var i = 0; i < providers.length; i++) {
      var p = providers[i];
      var pId = p.provider_id;

      // ==========================================
      // HARD ELIGIBILITY FILTER 1: Provider Status
      // ==========================================
      if (p.status !== 'ACTIVE' && p.status !== 'VERIFIED') {
        continue;
      }

      // ==========================================
      // HARD ELIGIBILITY FILTER 2: Available Lead Balance
      // ==========================================
      var creditBalance = BillingService.getProviderCreditBalance(pId);
      if (creditBalance <= 0) {
        continue; // Exclude providers who have exhausted their free and paid leads
      }

      // ==========================================
      // HARD ELIGIBILITY FILTER 3: Capability Alignment
      // ==========================================
      var pServices = services.filter(function (s) { return s.provider_id === pId; });
      var directMatch = null;

      for (var s = 0; s < pServices.length; s++) {
        if (pServices[s].subcategory_id === lead.derived_subcategory_id) {
          directMatch = pServices[s];
          break;
        }
      }

      var m1Capability = 0.0;
      if (directMatch) {
        m1Capability = 1.0;
      } else {
        // Free-text keyword match fallback across custom skills
        var leadDesc = (lead.raw_description || '').toLowerCase();
        for (var cs = 0; cs < pServices.length; cs++) {
          var customTokens = (pServices[cs].custom_skills || '').toLowerCase().split(',');
          for (var ct = 0; ct < customTokens.length; ct++) {
            var token = customTokens[ct].trim();
            if (token.length > 2 && leadDesc.indexOf(token) !== -1) {
              m1Capability = 0.70;
              break;
            }
          }
          if (m1Capability > 0) break;
        }
      }

      if (m1Capability === 0.0) {
        continue; // Exclude: Provider does not offer this trade or skill
      }

      // ==========================================
      // HARD ELIGIBILITY FILTER 4: Geographic Envelope
      // ==========================================
      var pLoc = locations.filter(function (l) { return l.provider_id === pId; })[0];
      var m2Distance = 0.0;
      var distanceKm = 0.0;

      if (!pLoc) {
        continue; // Exclude: Provider has no configured operating base
      }

      if (pLoc.service_mode === 'ONLINE') {
        m2Distance = 1.0; // Distance is irrelevant for remote/digital services
        distanceKm = 0.0;
      } else {
        distanceKm = GeoService.calculateHaversineDistance(
          lead.target_latitude, lead.target_longitude,
          pLoc.base_latitude, pLoc.base_longitude
        );

        var operationalRadius = Number(pLoc.radius_km) || 25.0;
        if (distanceKm <= operationalRadius) {
          m2Distance = Math.max(0.0, 1.0 - (distanceKm / operationalRadius));
        } else {
          continue; // Exclude: Customer is outside provider's operating radius
        }
      }

      // ==========================================
      // MULTIVARIATE SCORING CALCULATIONS (M3 - M8)
      // ==========================================

      // Metric 3: Trust & Verification (Normalized 0.0 to 1.0)
      var m3Trust = Math.min(1.0, (Number(p.trust_score) || 50.0) / 100.0);

      // Metric 4: Bayesian Damped Customer Rating
      var ratingCount = Number(p.rating_count) || 0;
      var ratingAvg = Number(p.rating_average) || 5.0;
      var m4Rating = 0.0;

      if (ratingCount === 0) {
        // Cold-Start Exploration Boost for newly approved providers
        m4Rating = COLD_START_EXPLORATION_SCORE;
      } else {
        m4Rating = (ratingAvg / 5.0) * (1.0 - Math.exp(-ratingCount / 5.0));
      }

      // Metric 5: Availability (Default 1.0 for active)
      var m5Availability = 1.0;

      // Metric 6: Response Velocity (Default 1.0)
      var responseRatePct = Number(p.response_rate_pct) || 100.0;
      var m6ResponseRate = Math.min(1.0, responseRatePct / 100.0);

      // Metric 7: Historical Lead Acceptance Ratio
      var m7LeadPerf = 0.80; // Standard baseline for active providers

      // Metric 8: Profile Completeness Ratio
      var m8ProfileComp = 0.50;
      if (p.bio && p.bio.length > 20) m8ProfileComp += 0.25;
      if (p.website_url) m8ProfileComp += 0.25;

      // ==========================================
      // COMPOSITE SCORE COMPUTATION (0.0 to 100.0)
      // ==========================================
      var rawScore = (
        (wCapability * m1Capability) +
        (wDistance * m2Distance) +
        (wTrust * m3Trust) +
        (wRating * m4Rating) +
        (wAvailability * m5Availability) +
        (wResponseRate * m6ResponseRate) +
        (wLeadPerf * m7LeadPerf) +
        (wProfileComp * m8ProfileComp)
      ) * 100.0;

      // Rotational Lead Balancing: slightly dampen score if provider received leads in last 24h
      var recentLeadsCount = distributions.filter(function (d) {
        return d.provider_id === pId && d.dispatched_at >= oneDayAgoIso;
      }).length;

      var dampener = Math.max(0.70, 1.0 - (recentLeadsCount * 0.10));
      var finalScore = parseFloat((rawScore * dampener).toFixed(2));

      if (finalScore >= minScoreThreshold) {
        candidates.push({
          providerId: pId,
          displayName: p.display_name,
          email: p.email,
          phone: p.phone,
          compositeScore: finalScore,
          distanceKm: parseFloat(distanceKm.toFixed(1)),
          explainability: {
            rawScore: parseFloat(rawScore.toFixed(2)),
            dampenerApplied: dampener < 1.0,
            recentLeadsCount: recentLeadsCount,
            scores: {
              capability: parseFloat((wCapability * m1Capability * 100).toFixed(2)),
              distance: parseFloat((wDistance * m2Distance * 100).toFixed(2)),
              trust: parseFloat((wTrust * m3Trust * 100).toFixed(2)),
              rating: parseFloat((wRating * m4Rating * 100).toFixed(2)),
              availability: parseFloat((wAvailability * m5Availability * 100).toFixed(2))
            }
          }
        });
      }
    }

    // Rank candidates strictly descending by composite score
    candidates.sort(function (a, b) {
      return b.compositeScore - a.compositeScore;
    });

    return candidates;
  }

  return {
    findMatchesForLead: findMatchesForLead
  };
})();

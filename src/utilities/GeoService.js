/**
 * Universal Service Demand-to-Supply Matching Engine
 * File: src/utilities/GeoService.js
 * 
 * Geospatial computation and address resolution subsystem.
 * Calculates spherical surface distances via the spherical law of haversines.
 * Resolves free-form locality and postal strings using Google's built-in Maps Geocoder.
 * 
 * Includes CacheService memoization to conserve Google Apps Script free daily geocoding quotas.
 * Compatible with modern V8 runtime. Zero external paid dependencies.
 */

var GeoService = (function () {
  'use strict';

  var EARTH_RADIUS_KM = 6371.0;
  var GEOCODE_CACHE_TTL_SEC = 21600; // 6-hour cache TTL for resolved addresses

  /**
   * Validates whether a coordinate pair falls within valid global geographic bounds.
   * 
   * @param {number} lat - Latitude (-90.0 to +90.0)
   * @param {number} lon - Longitude (-180.0 to +180.0)
   * @return {boolean} True if coordinates are numerically valid
   */
  function isValidCoordinate(lat, lon) {
    if (lat === null || lat === undefined || lon === null || lon === undefined) {
      return false;
    }
    var numLat = Number(lat);
    var numLon = Number(lon);
    if (isNaN(numLat) || isNaN(numLon)) {
      return false;
    }
    return numLat >= -90.0 && numLat <= 90.0 && numLon >= -180.0 && numLon <= 180.0;
  }

  /**
   * Calculates the great-circle surface distance between two geographic points in kilometers
   * using the spherical law of haversines.
   * 
   * @param {number} lat1 - Latitude of Point 1
   * @param {number} lon1 - Longitude of Point 1
   * @param {number} lat2 - Latitude of Point 2
   * @param {number} lon2 - Longitude of Point 2
   * @return {number} Distance in kilometers, or Infinity if coordinates are invalid
   */
  function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    if (!isValidCoordinate(lat1, lon1) || !isValidCoordinate(lat2, lon2)) {
      return Infinity;
    }

    var numLat1 = Number(lat1);
    var numLon1 = Number(lon1);
    var numLat2 = Number(lat2);
    var numLon2 = Number(lon2);

    // Exact identical coordinates check (avoids floating point calculation)
    if (numLat1 === numLat2 && numLon1 === numLon2) {
      return 0.0;
    }

    var dLat = (numLat2 - numLat1) * Math.PI / 180.0;
    var dLon = (numLon2 - numLon1) * Math.PI / 180.0;

    var radLat1 = numLat1 * Math.PI / 180.0;
    var radLat2 = numLat2 * Math.PI / 180.0;

    var a = Math.sin(dLat / 2.0) * Math.sin(dLat / 2.0) +
            Math.sin(dLon / 2.0) * Math.sin(dLon / 2.0) * Math.cos(radLat1) * Math.cos(radLat2);
    var c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));

    var distance = EARTH_RADIUS_KM * c;
    return parseFloat(distance.toFixed(3)); // Precision to within 1 meter
  }

  /**
   * Resolves a free-form address, city, or postal code string into latitude and longitude.
   * Leverages CacheService memoization to protect against the 1,000 requests/day Geocoder quota.
   * 
   * @param {string} address - Free-form locality text (e.g., 'Springfield, OR', '97477')
   * @return {Object|null} { latitude: number, longitude: number, formattedAddress: string } or null
   */
  function geocodeAddress(address) {
    if (!address || typeof address !== 'string' || address.trim() === '') {
      return null;
    }

    var cleanAddress = address.trim();
    var cacheKey = 'GEO_' + cleanAddress.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 80);
    var cache = CacheService.getScriptCache();

    // 1. Check in-memory / script cache
    var cachedJson = cache.get(cacheKey);
    if (cachedJson) {
      try {
        return JSON.parse(cachedJson);
      } catch (e) {
        // Cache parse failure: proceed to live query
      }
    }

    // 2. Perform live resolution using Google Apps Script Maps Service
    try {
      var geocoder = Maps.newGeocoder();
      var response = geocoder.geocode(cleanAddress);

      if (response && response.status === 'OK' && response.results && response.results.length > 0) {
        var firstResult = response.results[0];
        var geoResult = {
          latitude: parseFloat(firstResult.geometry.location.lat.toFixed(6)),
          longitude: parseFloat(firstResult.geometry.location.lng.toFixed(6)),
          formattedAddress: firstResult.formatted_address || cleanAddress
        };

        // Store result in cache
        cache.put(cacheKey, JSON.stringify(geoResult), GEOCODE_CACHE_TTL_SEC);
        return geoResult;
      }
    } catch (err) {
      Logger.log('GeoService.geocodeAddress: Geocoding error for "' + cleanAddress + '": ' + err.message);
    }

    return null;
  }

  /**
   * Checks whether a customer target coordinate falls within a provider's operational radial boundary.
   * 
   * @param {number} targetLat - Customer request latitude
   * @param {number} targetLon - Customer request longitude
   * @param {number} baseLat - Provider operating base latitude
   * @param {number} baseLon - Provider operating base longitude
   * @param {number} radiusKm - Provider service radius in kilometers
   * @return {boolean} True if customer is inside service envelope
   */
  function isWithinRadius(targetLat, targetLon, baseLat, baseLon, radiusKm) {
    var distance = calculateHaversineDistance(targetLat, targetLon, baseLat, baseLon);
    return distance <= Number(radiusKm);
  }

  return {
    isValidCoordinate: isValidCoordinate,
    calculateHaversineDistance: calculateHaversineDistance,
    geocodeAddress: geocodeAddress,
    isWithinRadius: isWithinRadius
  };
})();

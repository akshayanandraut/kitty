import { communitySpaces, faithFocuses, regionFocuses, styleTags } from './group-options.js';

export function discoveryQuery(query = {}) {
  const search = typeof query.search === 'string' ? query.search.trim().replace(/\s+/g, ' ') : '';
  if (search.length > 80) throw new Error('invalid_search');
  const faithFocus = query.faithFocus ?? 'any';
  const communitySpace = query.communitySpace ?? 'all';
  const regionFocus = query.regionFocus ?? 'any';
  const styleTag = query.styleTag ?? 'any';
  if (!faithFocuses.includes(faithFocus) || !communitySpaces.includes(communitySpace) || !regionFocuses.includes(regionFocus) ||
      (styleTag !== 'any' && !styleTags.includes(styleTag))) throw new Error('invalid_filter');
  const hasLocation = query.lat !== undefined || query.lon !== undefined;
  if (!hasLocation) return { search, faithFocus, communitySpace, regionFocus, styleTag, nearby: null };
  const lat = Number(query.lat);
  const lon = Number(query.lon);
  const radiusKm = query.radiusKm === undefined ? 25 : Number(query.radiusKm);
  if (query.lat === '' || query.lon === '' || !Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180 ||
      !Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 100) throw new Error('invalid_location');
  return { search, faithFocus, communitySpace, regionFocus, styleTag, nearby: { lat, lon, radiusKm } };
}

export function publicAreaPin(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new Error('invalid_location');
  return { latitude: Math.round(lat * 100) / 100, longitude: Math.round(lon * 100) / 100 };
}

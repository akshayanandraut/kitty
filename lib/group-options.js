export const faithFocuses = ['any', 'hindu', 'muslim', 'christian', 'catholic', 'sikh', 'jain', 'buddhist', 'other'];
export const communitySpaces = ['all', 'lesbian', 'lgbtq'];
export const regionFocuses = ['any', 'north_india', 'south_india', 'east_india', 'west_india', 'central_india', 'northeast_india', 'northwest_india', 'southeast_india', 'southwest_india', 'punjabi', 'assamese', 'other'];
export const styleTags = ['saree', 'western', 'party', 'beach', 'active', 'modest', 'hijab', 'burkha', 'rida', 'swimwear', 'sweet', 'glam', 'bold', 'casual'];

// Faith belongs in a group's explicit audience setting, never in its public name.
const religionName = /(^|[^\p{L}])(hindu(?:ism|s)?|muslim(?:s)?|islam(?:ic)?|christian(?:ity|s)?|catholic(?:s)?|sikh(?:ism|s)?|jain(?:ism|s)?|buddhist(?:s)?|buddhism|jew(?:ish|s)?|parsi(?:s)?|zoroastrian(?:s)?)(?=$|[^\p{L}])|हिंदू|हिन्दू|मुस्लिम|इस्लाम|सिख|जैन|बौद्ध|ईसाई/iu;

export function groupTitle(value) {
  if (typeof value !== 'string') throw new Error('invalid_group_name');
  const title = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!title || title.length > 80 || religionName.test(title)) throw new Error('invalid_group_name');
  return title;
}

export function groupOptions(input = {}) {
  const faithFocus = input.faithFocus ?? 'any';
  const communitySpace = input.communitySpace ?? 'all';
  const regionFocus = input.regionFocus ?? 'any';
  const tags = input.styleTags ?? [];
  if (!faithFocuses.includes(faithFocus) || !communitySpaces.includes(communitySpace) || !regionFocuses.includes(regionFocus) ||
      !Array.isArray(tags) || tags.length > 3 || new Set(tags).size !== tags.length ||
      tags.some(tag => !styleTags.includes(tag))) throw new Error('invalid_group_options');
  return { faithFocus, communitySpace, regionFocus, styleTags: tags };
}

export const needsAudienceConfirmation = ({ faithFocus = 'any', communitySpace = 'all' }) =>
  faithFocus !== 'any' || communitySpace !== 'all';

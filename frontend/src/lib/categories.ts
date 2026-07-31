export const ORG_CATEGORIES = [
  'Podcast',
  'Radio',
  'Conference',
  'Meetup',
  'Education',
  'Entertainment',
  'Sports',
  'News',
  'Music',
  'Technology',
  'Business',
  'Community',
] as const;

export type OrgCategory = typeof ORG_CATEGORIES[number];

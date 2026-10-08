/**
 * Interview prompts shown beside the recorder, and the section outlines the
 * notes/profile synthesis fills. Pure module — shared by client and server.
 */

import type { SubjectType } from './roster';

export const INTERVIEW_PROMPTS: Record<SubjectType, { topic: string; questions: string[] }[]> = {
  owner: [
    {
      topic: 'Relationship & history',
      questions: [
        'How did they come to HDPM, and how long have you worked with them?',
        'What is the backstory — inherited, accidental landlord, investor, retiree?',
      ],
    },
    {
      topic: 'Communication',
      questions: [
        'How do they like to be contacted (call, text, email), and how fast do they expect replies?',
        'Who else is involved — spouse, partner, CPA, attorney, adult kids?',
        'Topics to handle carefully, or things that set them off?',
      ],
    },
    {
      topic: 'Money & decisions',
      questions: [
        'How do they make repair decisions — approval threshold, need multiple bids, preferred vendors?',
        'How price-sensitive are they on rent, turns and capital improvements?',
        'Reserves, distributions, statements — anything they always ask about?',
      ],
    },
    {
      topic: 'Goals & risk',
      questions: [
        'What are their plans — hold, sell, buy more, refinance?',
        'Any history of disputes, complaints, or close calls on cancelling?',
        'What keeps them happy? What would make them leave?',
      ],
    },
  ],
  property: [
    {
      topic: 'The building',
      questions: [
        'Anything unusual about the layout, age or construction?',
        'Known recurring problems — plumbing, roof, HVAC, water heater, sewer, pests?',
        'Where are the shutoffs, panels, crawlspace access and cleanouts?',
      ],
    },
    {
      topic: 'Vendors & access',
      questions: [
        'Which vendors know this property best, and who should never go back?',
        'Lockbox, gate codes, keys, pets, or access quirks?',
        'HOA, utilities, irrigation, snow or landscaping arrangements?',
      ],
    },
    {
      topic: 'Tenants & neighborhood',
      questions: [
        'What kind of tenants do well here, and what turns have been rough?',
        'Neighbor issues, parking, noise, or anything local to know?',
      ],
    },
    {
      topic: 'Owner & money',
      questions: [
        'What has the owner said about upgrades or what they will and will not pay for?',
        'Rent history, concessions, or deals that are not written down anywhere?',
      ],
    },
  ],
};

export const PROFILE_SECTIONS: Record<SubjectType, string[]> = {
  owner: [
    'At a glance',
    'Relationship & history',
    'Communication preferences',
    'Decision-making & approvals',
    'Financial posture',
    'Goals & plans',
    'Sensitivities & watch-outs',
    'People involved',
    'Open questions',
  ],
  property: [
    'At a glance',
    'Building & systems',
    'Known issues & history',
    'Access, keys & utilities',
    'Vendors',
    'Tenants & neighborhood',
    'Owner expectations',
    'Open questions',
  ],
};

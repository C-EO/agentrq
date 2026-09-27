// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

import { DEFAULT_WORKSPACE_MISSION, WORKSPACE_WORKING_RULES } from './workspaceForm';

/**
 * Suggested missions, by category and then by speciality. They only pre-fill
 * the mission field of the create and settings forms; nothing about a
 * category is stored, so the text stays the person's to edit.
 */
const CATALOGUE = [
  {
    id: 'coding',
    label: 'Coding',
    subcategories: [
      {
        id: 'backend',
        label: 'Backend',
        role: 'backend development',
        focus: [
          'Design APIs and data models that are simple to call and hard to misuse.',
          'Cover every change with tests, and run the suite before calling it done.',
          'Keep migrations reversible and never break a running client.',
        ],
      },
      {
        id: 'frontend',
        label: 'Frontend',
        role: 'frontend development',
        focus: [
          'Build accessible, responsive screens that work on phones and desktops, in light and dark themes.',
          'Reuse the existing components and styles before adding new ones.',
          'Share a screenshot of every visible change.',
        ],
      },
      {
        id: 'ios',
        label: 'iOS',
        role: 'iOS app development',
        focus: [
          'Follow the platform conventions and keep the app smooth on older devices.',
          'Test on the simulator and on a real device before a release.',
          'Mind App Store review rules when adding permissions or payments.',
        ],
      },
      {
        id: 'android',
        label: 'Android',
        role: 'Android app development',
        focus: [
          'Follow Material conventions and support the range of screen sizes and OS versions the app targets.',
          'Test on an emulator and a real device before a release.',
          'Mind Play Store policies when adding permissions or payments.',
        ],
      },
      {
        id: 'testing',
        label: 'Testing',
        role: 'testing and quality assurance',
        focus: [
          'Write tests that fail for the bug before they pass for the fix.',
          'Report each defect with steps to reproduce, expected and actual results.',
          'Keep the suite fast and free of flaky tests.',
        ],
      },
    ],
  },
  {
    id: 'sales',
    label: 'Sales',
    subcategories: [
      {
        id: 'prospecting',
        label: 'Prospecting',
        role: 'finding and qualifying leads',
        focus: [
          'Research companies and contacts that fit the ideal customer profile.',
          'Record every lead with its source and why it fits.',
          'Never contact anyone without the human approving the list first.',
        ],
      },
      {
        id: 'outreach',
        label: 'Outreach',
        role: 'sales outreach',
        focus: [
          'Draft short, personal messages that lead with the prospect\'s problem.',
          'Plan follow-ups and track replies.',
          'Send nothing on the human\'s behalf until they approve the draft.',
        ],
      },
      {
        id: 'crm',
        label: 'CRM',
        role: 'keeping the sales pipeline up to date',
        focus: [
          'Keep every deal\'s stage, next step and owner current.',
          'Flag deals that have gone quiet.',
          'Summarise the pipeline each week.',
        ],
      },
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    subcategories: [
      {
        id: 'social-media',
        label: 'Social Media',
        role: 'social media marketing',
        focus: [
          'Plan a posting calendar that suits each platform.',
          'Draft posts in the brand\'s voice, with visuals where they help.',
          'Publish nothing until the human approves it, and report what performed.',
        ],
      },
      {
        id: 'youtube',
        label: 'YouTube',
        role: 'YouTube marketing',
        focus: [
          'Research topics and keywords the audience searches for.',
          'Draft titles, descriptions, scripts and thumbnail ideas.',
          'Track views, watch time and subscribers, and suggest what to try next.',
        ],
      },
      {
        id: 'content-seo',
        label: 'Content & SEO',
        role: 'content marketing and SEO',
        focus: [
          'Plan articles around what the audience searches for.',
          'Write clear, accurate drafts with sources for every claim.',
          'Track rankings and traffic, and refresh pages that slip.',
        ],
      },
      {
        id: 'email',
        label: 'Email',
        role: 'email marketing',
        focus: [
          'Plan campaigns and newsletters for each audience segment.',
          'Draft subject lines and bodies, and suggest what to A/B test.',
          'Send nothing until the human approves it, and report opens and clicks.',
        ],
      },
    ],
  },
  {
    id: 'ops',
    label: 'Ops',
    subcategories: [
      {
        id: 'devops',
        label: 'DevOps',
        role: 'infrastructure and DevOps',
        focus: [
          'Keep deployments repeatable, with every change in version control.',
          'Watch for alerts, cost and security issues, and report them.',
          'Ask before anything that could cause downtime or lose data.',
        ],
      },
      {
        id: 'support',
        label: 'Support',
        role: 'customer support',
        focus: [
          'Triage incoming requests by urgency and topic.',
          'Draft friendly, accurate replies, and escalate what needs the human.',
          'Turn repeated questions into help articles.',
        ],
      },
      {
        id: 'admin',
        label: 'Admin & Finance',
        role: 'business operations',
        focus: [
          'Keep documents, invoices and schedules organised.',
          'Prepare reports and reminders ahead of deadlines.',
          'Never make a payment or sign anything without the human.',
        ],
      },
    ],
  },
];

function missionFor(category, sub) {
  const focus = sub.focus.map((line) => `- ${line}`).join('\n');
  return `This workspace is for ${sub.role} (${category.label}). Describe the project, its goal, and anything an agent should know before it starts.

**Focus**
${focus}

${WORKSPACE_WORKING_RULES}`;
}

/**
 * The categories offered above a mission field, each with its specialities
 * and the mission text choosing one pre-fills.
 */
export const MISSION_CATEGORIES = CATALOGUE.map((category) => ({
  id: category.id,
  label: category.label,
  subcategories: category.subcategories.map((sub) => ({
    id: sub.id,
    label: sub.label,
    mission: missionFor(category, sub),
  })),
}));

const ALL_MISSIONS = MISSION_CATEGORIES.flatMap((c) => c.subcategories.map((s) => s.mission));

/**
 * Whether a mission can be replaced by a template without losing anything:
 * it is empty, the form's default, or a template nobody has edited since.
 */
export function isUntouchedMission(text) {
  const trimmed = (text ?? '').trim();
  return trimmed === '' || trimmed === DEFAULT_WORKSPACE_MISSION || ALL_MISSIONS.includes(trimmed);
}

/** The category and speciality whose template the text is, unedited, or null. */
export function findMissionTemplate(text) {
  const trimmed = (text ?? '').trim();
  for (const category of MISSION_CATEGORIES) {
    const sub = category.subcategories.find((s) => s.mission === trimmed);
    if (sub) return { categoryId: category.id, subcategoryId: sub.id };
  }
  return null;
}

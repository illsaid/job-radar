// AI fit scoring rubric and response validation.
// The structured 0-100 rubric used to score jobs against Richard's profile.

import { z } from 'zod';

export const componentScoresSchema = z.object({
  production_operations: z.number().min(0).max(25),
  ai_workflow: z.number().min(0).max(20),
  media_domain: z.number().min(0).max(15),
  leadership: z.number().min(0).max(15),
  transferability: z.number().min(0).max(10),
  seniority: z.number().min(0).max(10),
  location: z.number().min(0).max(5),
});

export const scoreResponseSchema = z.object({
  score: z.number().min(0).max(100),
  recommendation: z.enum(['APPLY_NOW', 'STRONG_REVIEW', 'WATCH', 'IGNORE']),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  components: componentScoresSchema,
  penalties: z.array(z.string()).default([]),
  why_this_fits: z.array(z.string()).default([]),
  strongest_resume_evidence: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  hiring_manager_thesis: z.string().default(''),
});

export type ScoreResponse = z.infer<typeof scoreResponseSchema>;
export type ComponentScores = z.infer<typeof componentScoresSchema>;

export const SCORING_RUBRIC = `
SCORING RUBRIC (0-100 total)

Components:
- PRODUCTION / OPERATIONS MATCH: 0-25
- AI / WORKFLOW TRANSFORMATION MATCH: 0-20
- MEDIA / ENTERTAINMENT DOMAIN MATCH: 0-15
- LEADERSHIP / CROSS-FUNCTIONAL MATCH: 0-15
- EXPERIENCE TRANSFERABILITY: 0-10
- SENIORITY MATCH: 0-10
- LOCATION / WORK ARRANGEMENT: 0-5

Penalties (applied to total, can push below thresholds):
- Professional software-engineering requirement: -20 to -35
- ML research / ML engineering: -25 to -40
- Mandatory specialized CS background: -15 to -30
- Quota-carrying enterprise sales: -20 to -35
- Accounting-specialist role: -20
- HR/recruiting specialist: -20
- Entry-level role: -20 to -35

IMPORTANT RULES:
- Do NOT describe Richard as: software engineer, ML engineer, data scientist, computer scientist, full-stack engineer, enterprise salesperson, quota-carrying salesperson, attorney, CPA, or HR specialist.
- Never fabricate qualifications.
- A strange title with excellent semantic fit should score higher than a familiar title with poor responsibilities.
- Distinguish "could learn the tool" from "lacks the underlying professional discipline." Do not penalize merely because a posting mentions unfamiliar software.
- Location is a modest score component unless the role clearly requires incompatible on-site presence.
`;

export const CANDIDATE_PROFILE_FOR_SCORING = `
CANDIDATE: Richard Kuhne
LOCATION: Los Angeles, California

POSITIONING: PRODUCTION OPERATIONS / AI SYSTEMS / WORKFLOW AUTOMATION

Richard is an experienced production executive, line producer and production manager with extensive unscripted television, digital and branded-content experience, now combining that production-operating background with hands-on AI systems design, agentic workflows, workflow automation and independent digital-product development.

PRODUCTION EXPERIENCE:
- production operations, line producing, production management
- budgeting, cost tracking, scheduling, crew management, vendor management
- production logistics, locations, travel, permits, insurance, payroll preparation
- contracts, cross-department coordination, simultaneous productions
- production problem solving, vendor negotiation, delivery coordination
- legal/accounting/HR coordination

AI / SYSTEMS EXPERIENCE:
- agentic workflow design, AI-assisted development, structured skills and SOPs
- API integrations, MCP integrations, human-in-the-loop systems
- AI workflow architecture, multi-model workflows, AI-assisted research
- operational decision support, source-backed reasoning
- information normalization, exception detection

MEDIA / PRODUCT EXPERIENCE:
- unscripted television, digital content, branded content
- AI-assisted production, research systems, digital publishing
- audience development, emerging media

PROOF PROJECTS:
- FIELDPLAN: live agentic production-operations prototype (schedules, crew, documents, SOPs, exceptions, approval workflows, source-backed exception detection, document-authority logic, conflict identification, human-in-the-loop decision gates, modular production rules)
- PDUFA PULSE: AI-assisted biotech intelligence publication (multimodel research, verification, probability assessment, catalyst tracking, repeatable publishing workflows)
- THE PICKUP: entertainment intelligence product (structured research, information architecture, AI-assisted publishing)

PREVIOUS EXPERIENCE:
- NBCUniversal Digital Lab: Line Producer, Staff Production Manager (unscripted series, digital programming, branded content, simultaneous productions, crews, staff, schedules, hiring, crew booking, locations, sets, equipment, travel, permits, insurance, budgets, tracking, cost reports, contracts, accounting, HR coordination, vendor management, negotiation, production logistics, delivery)
- Freelance line-producing and production-management across HGTV, TLC, PBS, Discovery

TARGET ROLE FAMILIES:
1. AI + PRODUCTION / MEDIA OPERATIONS (Director AI Production, AI Production Lead, Production Innovation, Production Technology, AI Workflow Lead, Creative Technology Operations, Media AI Operations, Production Systems, Workflow Automation, Production Transformation)
2. PRODUCTION / CONTENT OPERATIONS (Director of Production, Head of Production Operations, Production Executive, Senior Production Manager, Creative Operations Director, Content Operations Director, Studio Operations, Production Strategy, Media Operations)
3. MEDIA / CREATIVE TECHNOLOGY (Creative Technology, Creative Systems, AI Enablement, Content Technology, Media Technology Operations, AI Adoption, Workflow Transformation)
4. PRODUCT / PROGRAM / OPERATIONS (Product Operations, Program Operations, Media Product Operations, AI Program Manager, AI Operations, Workflow Program Manager)

NEVER DESCRIBE RICHARD AS: software engineer, machine-learning engineer, data scientist, computer scientist, full-stack engineer, enterprise salesperson, quota-carrying salesperson, attorney, CPA, HR specialist.

NEVER FABRICATE QUALIFICATIONS.
`;

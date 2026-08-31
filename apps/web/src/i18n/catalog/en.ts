import type { Catalog } from './es';

/**
 * The English catalogue.
 *
 * Typed as a COMPLETE `Catalog` on purpose: English is a language BusinessBrain claims to
 * speak, and a half-translated interface is worse than one that never offered the language.
 * Adding a key to the Spanish catalogue without translating it here stops the build — which is
 * the point.
 *
 * Future languages (fr, de, it, pt, ca) may enter as `Partial<Catalog>` and fall back to
 * Spanish key by key, so a translation can land in pieces without breaking anything.
 *
 * Written for a small business owner, not for a developer. Where Spanish says "conocimiento"
 * meaning "the documents this company has given us", English says exactly that.
 */
export const en: Catalog = {
  // ── Common ───────────────────────────────────────────────────────────────
  'common.loading': 'Loading…',
  'common.save': 'Save',
  'common.saving': 'Saving…',
  'common.cancel': 'Cancel',
  'common.create': 'Create',
  'common.delete': 'Delete',
  'common.close': 'Close',
  'common.back': 'Back',
  'common.none': '—',
  'common.moment': 'One moment…',
  'common.retry': 'Try again',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.of': 'of',
  'common.sessionLoading': 'Loading your session…',


  // ── States of any screen ──────────────────────────────────────────────────
  'state.retry': 'Try again',
  'state.empty': 'Nothing here yet.',
  'state.error.unknown': 'We could not load this.',
  'state.error.unknownHint': 'It may be a passing problem. Try again; if it keeps happening, let us know.',
  'state.error.forbidden': 'You do not have permission to see this.',
  'state.error.missing': 'This no longer exists.',

  'page.insights.subtitle': 'What BusinessBrain has understood from your documents. Every conclusion says where it comes from and whether it still holds.',
  'page.objectives.subtitle': 'What your company wants to achieve. Without objectives the system describes what happens but cannot tell you whether it matters.',
  'page.analysis.subtitle':
    'Ask BusinessBrain to go over everything it has read and tell you what it found.',
  'page.recommendations.subtitle': 'What is worth doing, with the reason up front. You decide: accept, discard or leave it for later.',
  'page.automations.subtitle': 'Tasks that run on their own when due. Each one leaves a record of what it did and when.',
  'page.reports.subtitle': 'What has been understood, gathered into a document you can send or keep.',
  'nav.account': 'My account',
  'shell.menu': 'Menu',
  'dashboard.subtitle': 'What BusinessBrain knows about your company, and what is worth doing now.',
  'dashboard.steps.subtitle': 'Five steps for BusinessBrain to start understanding your company.',
  'dashboard.attention.subtitle': 'Conclusions that no longer fit what the system knows.',
  'dashboard.latest.subtitle': 'What it has worked out on its own from your documents.',
  'dashboard.latest.seeAll': 'See all',
  'dashboard.latest.emptyTitle': 'What BusinessBrain finds will appear here.',
  'dashboard.latest.emptyBody': 'Once it has documents and you run an analysis, it will look for risks, deviations and opportunities on its own, and tell you which document each one came from.',
  'dashboard.metric.documentsEmpty': 'What your company uploads',
  'dashboard.metric.conclusionsEmpty': 'What the analysis works out',
  'dashboard.metric.automationsEmpty': 'Analyses and reports on their own',
  'dashboard.metric.reportsEmpty': 'Reports with citations',
  'platform.mfaGate.title': 'Turn on two-step verification',
  'platform.mfaGate.subtitle': 'It is required to administer BusinessBrain. Until you have it, the rest of the panel stays closed.',
  'platform.mfaGate.why': 'Your account can request access to any client company’s data. If someone got hold of your password, it would not be one company’s problem: it would be every company’s. That is why the second factor is not optional here.',
  'platform.mfaGate.step1': 'Open your authentication app on your phone, or install one if you do not have it.',
  'platform.mfaGate.step2': 'Scan the code we show you and type the six digits.',
  'platform.mfaGate.step3': 'Keep the backup codes somewhere safe: they are your way in if you lose your phone.',
  'platform.mfaGate.action': 'Turn it on now',
  'platform.mfaGate.footnote': 'It takes less than a minute and you only do it once.',

  'account.title': 'My account',
  'account.subtitle': 'What is yours and travels with you even if you change company.',
  'account.who': 'Who you are',
  'account.whoHint': 'This is how BusinessBrain identifies you and how your colleagues see you.',
  'settings.title': 'Company settings',
  'settings.subtitle': 'What belongs to your company and affects the whole team.',
  'settings.section.ai': 'Artificial intelligence',
  'settings.section.privacy': 'Privacy and data',
  'settings.section.company': 'Company',
  'settings.section.team': 'Team and access',

  // ── Navigation ───────────────────────────────────────────────────────────
  'nav.group.understand': 'Understand',
  'nav.group.decide': 'Decide',
  'nav.group.execute': 'Run',
  'nav.group.account': 'Your account',
  'nav.dashboard': 'Overview',
  'nav.ask': 'Ask',
  'nav.knowledge': 'Knowledge',
  'nav.insights': 'Understanding',
  'nav.objectives': 'Objectives',
  'nav.analysis': 'Analysis',
  'nav.recommendations': 'Recommendations',
  'nav.automations': 'Automations',
  'nav.reports': 'Reports',
  'nav.settings': 'Settings',

  // ── Shell ────────────────────────────────────────────────────────────────
  'shell.activeOrganization': 'Active organisation',
  'shell.logout': 'Sign out',

  // ── System vocabulary, in plain English ──────────────────────────────────
  'status.knowledgeItem.PENDING': 'waiting its turn',
  'status.knowledgeItem.PROCESSING': 'reading it',
  'status.knowledgeItem.INDEXED': 'ready to consult',
  'status.knowledgeItem.FAILED': 'could not be read',
  'status.knowledgeItem.SUPERSEDED': 'earlier version',
  'status.knowledgeItem.DELETED': 'deleted',

  'status.insightType.PATTERN': 'pattern',
  'status.insightType.ANOMALY': 'deviation',
  'status.insightType.RISK': 'risk',
  'status.insightType.OPPORTUNITY': 'opportunity',

  'status.evidenceKind.KNOWLEDGE_ITEM': 'one of your documents',
  'status.evidenceKind.KNOWLEDGE_CHUNK': 'a passage from a document',
  'status.evidenceKind.CANONICAL_ENTITY': 'a fact recorded across several documents',
  'status.evidenceRole.BASELINE': 'supports it',
  'status.evidenceRole.DEVIATION': 'is what deviated',
  'status.evidenceRole.CONTRADICTION': 'contradicts it',
  'insight.evidence.none': 'Nothing within your scope is left supporting this conclusion.',

  'status.freshness.FRESH': 'up to date',
  'status.freshness.STALE': 'what supported it has changed',
  'status.freshness.UNRESOLVABLE': 'can no longer be checked',

  'status.run.PENDING': 'queued',
  'status.run.RUNNING': 'running',
  'status.run.SUCCESS': 'fine',
  'status.run.FAILED': 'with errors',
  'status.run.PARTIAL': 'partial',
  'status.run.CANCELLED': 'cancelled',

  'status.connection.PENDING': 'not read yet',
  'status.connection.CONNECTED': 'connected',
  'status.connection.SYNCING': 'reading',
  'status.connection.ERROR': 'has problems',
  'status.connection.DISABLED': 'disconnected',

  'status.role.OWNER': 'owner',
  'status.role.ADMIN': 'administrator',
  'status.role.MEMBER': 'member',
  'status.role.VIEWER': 'read only',

  'status.automation.ACTIVE': 'active',
  'status.automation.PAUSED': 'paused',
  'status.automation.ERROR': 'has problems',

  'status.insight.CANDIDATE': 'candidate',
  'status.insight.ACTIVE': 'active',
  'status.insight.SUPERSEDED': 'replaced',
  'status.insight.DISCARDED': 'discarded',
  'status.insight.EXPIRED': 'expired',

  'status.recommendation.NEW': 'pending',
  'status.recommendation.ACCEPTED': 'accepted',
  'status.recommendation.DISMISSED': 'dismissed',

  // ── Signing in ───────────────────────────────────────────────────────────
  'login.tagline': "Your company's intelligence layer.",
  'login.invited':
    'You have been invited to a company on BusinessBrain. Sign in or create your account with the email address you were invited with and you will be in.',
  'login.name': 'Name',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.signIn': 'Sign in',
  'login.createAccount': 'Create account',
  'login.toRegister': "Don't have an account? Create one",
  'login.toLogin': 'I already have an account',
  'login.forgot': 'Forgotten your password?',
  'login.invitationFailed':
    'You are in, but the invitation could not be accepted: {reason}',

  // ── Password recovery ────────────────────────────────────────────────────
  'recovery.title': 'Forgotten your password?',
  'recovery.explain':
    'Enter your email and we will send you a link to choose a new one.',
  'recovery.submit': 'Send me the link',
  'recovery.sending': 'Sending…',
  'recovery.backToLogin': 'Back to sign in',
  'recovery.sentTitle': 'Check your email.',
  'recovery.sentBody':
    'If there is an account with that address, you have just been sent a link to choose a new password. It expires in one hour.',
  'recovery.sentHint':
    'Not arrived? Check your spam folder, or whether the address was a different one.',
  'recovery.incompleteTitle': 'This link is incomplete.',
  'recovery.incompleteBody':
    'Copy the whole link from the email, or ask for a new one.',
  'recovery.askNew': 'Ask for a new link',
  'recovery.doneTitle': 'You have a new password.',
  'recovery.doneBody':
    'For your safety we have signed out any sessions that were open on other devices.',
  'recovery.chooseTitle': 'Choose your new password',
  'recovery.passwordHint': 'At least 8 characters.',
  'recovery.repeat': 'Repeat it',
  'recovery.mismatch': 'The two passwords are not the same.',
  'recovery.submitNew': 'Save and sign in',

  // ── Creating the company ─────────────────────────────────────────────────
  'onboarding.title': 'Welcome to BusinessBrain',
  'onboarding.intro':
    'The first step is registering your company. Everything BusinessBrain learns — documents, email, conclusions — lives inside it and is never mixed with anyone else’s.',
  'onboarding.introNamed':
    '{name}, the first step is registering your company. Everything BusinessBrain learns — documents, email, conclusions — lives inside it and is never mixed with anyone else’s.',
  'onboarding.companyName': 'Your company name',
  'onboarding.companyHint': 'You can change it later in Settings.',
  'onboarding.companyPlaceholder': 'Ruiz Bakery Ltd.',
  'onboarding.creating': 'Creating…',
  'onboarding.create': 'Create my company',
  'onboarding.alreadyInside':
    'If someone at your company already uses BusinessBrain, ask them to invite you instead of creating a second one: that way you share the same knowledge.',

  // ── Language ─────────────────────────────────────────────────────────────
  'settings.language': 'Language',
  'settings.languageHint':
    'Changes the interface and the language BusinessBrain answers you in. It does not translate your documents: they stay exactly as you uploaded them.',

  // ── Overview ─────────────────────────────────────────────────────────────
  'dashboard.metric.documents': 'Documents',
  'dashboard.metric.conclusions': 'Conclusions',
  'dashboard.metric.automations': 'Automations',
  'dashboard.metric.reports': 'Reports',
  'dashboard.todo.title': 'Waiting for you',
  'dashboard.todo.recommendations': 'Recommendations waiting for your decision',
  'dashboard.todo.recommendationsWhy':
    'BusinessBrain proposed them from your documents. None of them runs on its own.',
  'dashboard.todo.disputed': 'Conclusions someone has questioned',
  'dashboard.todo.stale': 'Conclusions whose document has changed',
  'dashboard.todo.see': 'Review',
  'dashboard.calm.title': 'Nothing is waiting for you',
  'dashboard.calm.body':
    'BusinessBrain keeps watching your documents. If something changes or it finds something that does not fit, it will show up here.',
  'dashboard.state.title': 'What it knows about your company',
  'dashboard.state.documents': 'documents read',
  'dashboard.state.conclusions': 'conclusions',
  'dashboard.state.lastAnalysis': 'Last analysis on {date}',
  'dashboard.state.neverAnalysed': 'You have not run any analysis yet.',
  'dashboard.state.ask': 'Ask',
  'dashboard.state.analyse': 'Analyse now',
  'dashboard.attention.title': 'Needs your attention',
  'dashboard.attention.disputedWhy':
    'Someone approved an earlier version and the new evidence contradicts it.',
  'dashboard.latest.title': 'The latest we have understood',
  'dashboard.latest.empty':
    'No conclusions yet. Add some knowledge and run an analysis.',
  'dashboard.steps.title': 'First steps',
  'dashboard.steps.progress': '{done} of {total} done.',
  'dashboard.steps.ai.action': 'Set up the artificial intelligence',
  'dashboard.steps.ai.why':
    'Without it BusinessBrain cannot read your documents or answer questions.',
  'dashboard.steps.source.action': 'Connect a source',
  'dashboard.steps.source.why':
    'Upload documents, a web page, your Google Drive or a Gmail label.',
  'dashboard.steps.sync.action': 'Upload your first document',
  'dashboard.steps.sync.why':
    'Until something comes in, BusinessBrain knows nothing about your company.',
  'dashboard.steps.ask.action': 'Ask it a question',
  'dashboard.steps.ask.why':
    'It will answer with what it knows and tell you which documents it came from.',
  'dashboard.steps.analysis.action': 'Run an analysis',
  'dashboard.steps.analysis.why':
    'It looks for risks, deviations and opportunities in what it already knows.',

  // ── Understanding ────────────────────────────────────────────────────────
  'common.confidence.low': 'low',
  'common.confidence.medium': 'medium',
  'common.confidence.high': 'high',
  'insights.title': 'Conclusions ({count})',
  'insights.empty':
    'There are no conclusions within your reach. There may be no analysis yet, or you may not have access to the collections they rest on.',
  'insight.badge.freshEvidence': 'up to date',
  'insight.badge.evidenceChanged': 'what supported it has changed',
  'insight.badge.evidenceUnresolvable': 'cannot be checked any more',
  'insight.badge.disputed': 'the decision no longer fits',
  'insight.badge.inherited': 'decided on an earlier version',
  'insight.badge.curated': 'reviewed by a person',

  // ── Analysis ─────────────────────────────────────────────────────────────
  'analysis.found.title': 'What it found',
  'analysis.found.none':
    'This analysis found nothing new. That is normal if no new knowledge has come in since the previous one.',
  'analysis.found.seeAll': 'See all the understanding',
  'analysis.proposed.title': 'And what it proposes',
  'analysis.proposed.seeAll': 'See the recommendations',
  'analysis.last.title': 'Latest analysis',
  'analysis.last.created': 'new conclusions',
  'analysis.last.updated': 'conclusions updated',
  'analysis.last.proposals': 'recommendations to review',
  'analysis.last.when': 'Analysed on {date}',
  'analysis.last.running': 'Analysing right now…',
  'analysis.last.failed': 'The latest analysis did not finish.',
  'analysis.last.nothingNew':
    'It found nothing new. That is normal if no new knowledge has come in since the last analysis.',
  'analysis.needs.title': 'What it needs in order to analyse',
  'analysis.needs.knowledge': 'Documents from your company',
  'analysis.needs.knowledgeWhy':
    'That is what it reasons over. With nothing read, there is nothing to analyse.',
  'analysis.needs.objectives': 'At least one objective',
  'analysis.needs.objectivesWhy':
    'Without objectives it can describe what happens, but not tell you whether it is a risk or an opportunity.',
  'analysis.needs.go': 'Go to Knowledge',
  'analysis.needs.goObjectives': 'Go to Objectives',
  'analysis.empty.title': 'BusinessBrain has not analysed your company yet',
  'analysis.empty.body':
    'It goes through everything it has read on its own and looks for risks, deviations and opportunities. Conclusions and recommendations come from there.',
  'analysis.history.title': 'Previous analyses',
  'analysis.history.summary': '{created} new · {updated} updated',
  'analysis.needsAdmin.title': 'Only an administrator can start an analysis',
  'analysis.needsAdmin.body':
    'An analysis reads all the company knowledge and spends the artificial intelligence key the company pays for. Ask whoever administers BusinessBrain in your company; you will still see the understanding it produces.',
  'analysis.run.button': 'Analyse now',
  'analysis.run.busy': 'Analysing…',
  'analysis.runs.title': 'Runs',
  'analysis.runs.column.status': 'Status',
  'analysis.runs.column.origin': 'Origin',
  'analysis.runs.column.started': 'Started',
  'analysis.runs.column.finished': 'Finished',
  'analysis.trigger.automatic': 'automatic',
  'analysis.trigger.manual': 'manual',

  // ── Objectives ───────────────────────────────────────────────────────────
  'objectives.pending.title': 'Waiting for your confirmation',
  'objectives.pending.why':
    'BusinessBrain believes it worked this out from your documents. Until you confirm it, it is not used to decide what matters.',
  'objectives.active.title': 'Objectives in progress',
  'objectives.active.why':
    'With these objectives, BusinessBrain can tell you whether what it finds is a risk or an opportunity, instead of just describing it.',
  'objectives.new.open': 'Create objective',
  'objectives.new.cancel': 'Cancel',
  'objectives.declaredBy': 'A person said so',
  'objectives.deducedBy': 'BusinessBrain worked it out',
  'objectives.since': 'since {date}',
  'objectives.created': 'Objective created. It already counts for the next analysis.',
  'objectives.confirmed': 'Confirmed. BusinessBrain now takes it into account.',
  'objectives.discarded': 'Discarded. It no longer counts towards analyses.',
  'objectives.empty.title': 'You have not yet told BusinessBrain what you want to achieve',
  'objectives.empty.body':
    'It is a short sentence about what you want to achieve: keep the margin, reduce returns, get paid sooner.',
  'objectives.empty.example':
    'For example: "The commercial margin must not fall below 30%".',
  'objectives.declare.title': 'Declare an objective',
  'objectives.declare.why':
    'Without a confirmed objective, the system can tell you what is happening, but not whether it is a risk or an opportunity for your company.',
  'objectives.field': 'Objective',
  'objectives.placeholder': 'Commercial margin must not fall below 30%.',
  'objectives.declare': 'Declare',
  'objectives.title': 'Objectives ({count})',
  'objectives.status.confirmed': 'confirmed',
  'objectives.status.inferred': 'proposed by the system',
  'objectives.origin.person': 'a person',
  'objectives.origin.inferred': 'inferred',
  'objectives.confirm': 'Confirm',
  'objectives.discard': 'Discard',

  // ── Asking ───────────────────────────────────────────────────────────────
  'ask.subtitle': 'Write whatever you want to know. It answers with what is in your company documents, and shows you where it came from.',
  'ask.tryThis': 'Try asking',
  'ask.emptyList': 'You have not asked anything yet.',
  'ask.thinkingHint': 'Reading your documents and checking where each fact comes from.',
  'ask.you': 'You',
  'ask.brain': 'BusinessBrain',
  'ask.list.title': 'Your questions',
  'ask.new': 'New question',
  'ask.untitled': 'Untitled',
  'ask.title': 'Ask your company',
  'ask.intro':
    'Ask in your own words. It will answer with what it knows about your company.',
  'ask.example1': 'What did we agree with our main supplier?',
  'ask.example2': 'What is our discount policy?',
  'ask.example3': 'What have we decided about returns?',
  'ask.noInvent':
    'If it does not have enough information, it will say so instead of making something up.',
  'ask.thinking': 'Searching your knowledge…',
  'ask.input.label': 'Your question',
  'ask.input.placeholder': 'What would you like to know about your company?',
  'ask.send': 'Ask',
  'ask.sending': 'Asking…',
  'ask.noSources':
    'No sources: this answer is not backed by any of your documents.',
  'ask.sources': 'Sources',
  'ask.sourceMissing': 'no longer at its origin',
  'ask.indexedAt': 'added on {date}',

  // ── Recommendations ──────────────────────────────────────────────────────
  'recs.pending.title': 'Waiting for your decision ({count})',
  'recs.pending.governance':
    'BusinessBrain proposes; you decide. Accepting records the decision — it does not carry out any action or change anything outside this screen.',
  'recs.pending.empty':
    'Nothing pending. When an analysis finds something worth acting on, it will appear here.',
  'recs.history.title': 'Earlier decisions',
  'recs.history.show': 'See earlier decisions',
  'recs.history.hide': 'Hide',
  'recs.history.empty': 'You have not accepted or dismissed any yet.',
  'recs.someone': 'someone',
  'recs.author.person': 'proposed by a person',
  'recs.author.system': 'proposed by BusinessBrain',
  'recs.field.detected': 'What we found',
  'recs.field.justification': 'Why it matters',
  'recs.field.impact': 'Expected impact',
  'recs.field.areas': 'Areas affected',
  'recs.field.advantages': 'In favour',
  'recs.field.drawbacks': 'Against',
  'recs.field.plan': 'Where to start',
  'recs.evidence.show': 'See what it is based on',
  'recs.evidence.hide': 'Hide',
  'recs.evidence.why': 'Why are you suggesting this?',
  'recs.evidence.from': 'It comes from this conclusion:',
  'recs.evidence.openIt':
    '(confidence {confidence}) — open it to see the documents it rests on.',
  'recs.evidence.gone': 'The conclusion behind it is no longer available.',
  'recs.accept': 'Accept',
  'recs.dismiss': 'Dismiss',
  'recs.readOnly':
    'Read only: ask a colleague with permissions to make the decision.',

  // ── One conclusion in detail ─────────────────────────────────────────────
  'insight.finding.CONFIDENCE_DECAYED.title':
    '"{document}" no longer offers the assurance your company requires',
  'insight.finding.CONFIDENCE_DECAYED.detected':
    'It no longer reaches the level of reliability your company requires to use a document as a reference.',
  'insight.finding.CONFIDENCE_DECAYED.matters':
    'While it stays like this, BusinessBrain will not use it to answer questions. It is worth reviewing it or uploading an updated version.',
  'insight.finding.SOURCE_DISCONNECTED.title':
    'The source "{source}" has stopped bringing information',
  'insight.finding.SOURCE_DISCONNECTED.detected':
    'It is disconnected or failing, so whatever came through it is no longer being updated.',
  'insight.finding.SOURCE_DISCONNECTED.matters':
    'There are {count} documents that depend on it and are falling out of date.',
  'insight.finding.CANONICALIZATION_UNRESOLVED.title':
    '{count} documents say different things about the same point',
  'insight.finding.CANONICALIZATION_UNRESOLVED.detected':
    'BusinessBrain cannot determine on its own which of them prevails.',
  'insight.finding.CANONICALIZATION_UNRESOLVED.matters':
    'Until someone decides, answers about this point may come out incomplete.',
  'insight.finding.goKnowledge': 'Go to Knowledge',
  'insight.finding.detected': 'What we found',
  'insight.finding.matters': 'Why it matters',
  'insight.finding.source': 'Where it comes from',
  'insight.finding.detail': 'See the technical detail',
  'insight.finding.detailHide': 'Hide the detail',
  'insight.finding.detailWhy':
    'What the system recorded when it detected this, as it is. Useful to check it or to pass on to whoever runs your systems.',
  'insight.certainty.inline': '{level} confidence',
  'insight.certainty.label': 'Confidence in this conclusion',
  'insight.certainty.explain':
    'How sure BusinessBrain is about what it states here. It is not the reliability of the documents: that one is in Knowledge, document by document.',
  'insight.notFound': 'Not found.',
  'insight.title': 'Conclusion',
  'insight.curatedOwn': 'Reviewed on this same version',
  'insight.curatedInherited': 'Reviewed on an earlier version',
  'insight.curatedOn': 'on {date}.',
  'insight.curationDisputed': 'What came in afterwards contradicts what was decided.',
  'insight.mattersBecause': 'It affects these objectives:',
  'insight.evidence': 'What supports it ({count})',
  'insight.decide.title': 'Your decision',
  'insight.decide.explain':
    'What you decide overrides any later recalculation, until you change it. Discarding it removes it from normal reading; it deletes nothing.',
  'insight.decide.field': 'Decision',
  'insight.decide.confirm': 'I confirm it',
  'insight.decide.correct': 'I correct it',
  'insight.decide.dismiss': 'I dismiss it',
  'insight.decide.comment': 'Comment (optional)',
  'insight.decide.submit': 'Record',
  'insight.decide.done': 'Decision recorded.',
  'insight.history.show': 'See how it has changed',
  'insight.history.hide': 'Hide',
  'insight.history.neverChanged': 'It has not changed since it was detected, on {date}.',
  'insight.history.changedTimes': 'It has changed {count} time(s) since it was detected.',
  'insight.history.lastChange': 'The last one, on {date}:',
  'insight.history.title': 'How it has changed',
  'insight.history.empty': 'There is no version you can see.',
  'insight.history.current': 'current version',
  'insight.history.superseded': 'earlier version',
  'insight.history.evidenceCount': 'supported by {count}',
  'insight.history.confidenceRose': 'It gained confidence because:',
  'insight.history.confidenceFell': 'It lost confidence because:',
  'insight.history.outOfScope':
    'And {count} more change(s) outside your reach, which we cannot detail.',
  'insight.history.hiddenVersions':
    'There are {count} version(s) of this belief you cannot see with your current reach.',
  'insight.change.ENTERED': 'new information came in',
  'insight.change.LEFT': 'stopped supporting it',
  'insight.change.CONTRADICTED': 'contradicted it',
  'insight.change.SUPERSEDED_EVIDENCE': 'its document was replaced',

  // ── Reports ──────────────────────────────────────────────────────────────
  'reports.new.open': 'Create report',
  'reports.new.cancel': 'Cancel',
  'reports.contains': 'What it contains',
  'reports.section.insights': 'What BusinessBrain has understood ({limit} at most)',
  'reports.section.search': 'Whatever it finds about "{query}"',
  'reports.generatedTimes': 'Generated {count} time(s)',
  'reports.neverGenerated': 'You have not generated it yet',
  'reports.empty.title': 'You have not created any report yet',
  'reports.empty.body':
    'It gathers into a PDF what BusinessBrain has understood, with the sources for every statement. To take to a meeting or send to your accountant.',
  'reports.empty.needsKnowledge':
    'You need at least one document read for the report to have something to say.',
  'reports.empty.needsAdmin':
    'Ask whoever administers BusinessBrain to create the first one.',
  'reports.title': 'Reports ({count})',
  'reports.new.title': 'New report',
  'reports.new.name': 'Report name',
  'reports.new.namePlaceholder': 'Weekly summary',
  'reports.new.limit': 'Items per section',
  'reports.new.sectionTitle': 'Title of the understanding section',
  'reports.new.sectionDefault': 'What we have understood',
  'reports.new.search': 'Add a search across your knowledge (optional)',
  'reports.new.searchHint':
    'It will search your documents and cite what it finds.',
  'reports.new.searchPlaceholder': 'discount policy',
  'reports.new.searchSection': 'About: {query}',
  'reports.new.submit': 'Save report',
  'reports.runs': 'Generations',
  'reports.runs.hide': 'Hide',
  'reports.runs.empty': 'No generations yet.',
  'reports.download': 'Download PDF',
  'reports.downloading': 'Generating…',
  'reports.scopeWarning':
    'The content depends on your reach: it only includes what you can see.',
  'reports.notStored':
    'the file is not kept; it is regenerated whenever it is needed',

  // ── Automations ──────────────────────────────────────────────────────────
  'automations.new.open': 'Create automation',
  'automations.new.submit': 'Save automation',
  'automations.new.cancel': 'Cancel',
  'automations.does': 'What it does',
  'automations.next': 'Next time',
  'automations.never': 'It has not run yet',
  'automations.ranTimes': 'It has run {count} time(s)',
  'automations.lastResultAt': 'Last time on {date}',
  'automations.paused.hint': 'Paused: it will not run until you resume it.',
  'automations.error.hint': 'The last run failed. Check the runs to see what happened.',
  'automations.empty.title': 'Nothing runs on its own yet',
  'automations.empty.body':
    'It repeats on its own, at the time you choose, what you now do by hand: re-read a web page, analyse and generate a report. It never sends anything outside.',
  'automations.empty.needsAdmin':
    'Ask whoever administers BusinessBrain to create the first one.',
  'automations.title': 'Automations ({count})',
  'automations.new.title': 'New automation',
  'automations.new.name': 'Name',
  'automations.new.namePlaceholder': 'Weekly sweep',
  'automations.new.when': 'When',
  'automations.new.timezone': 'Time zone: {timezone}',
  'automations.new.whatItDoes': 'What it will do',
  'automations.new.reread': 'Read again',
  'automations.new.sourceLabel': 'Source that will be read again',
  'automations.new.noSource': '(no source)',
  'automations.new.analyze': 'Analyse the knowledge and update the understanding',
  'automations.new.andReport': 'And generate the report',
  'automations.new.noReport': '(none)',
  'automations.new.governance':
    'An automation never sends anything outside or modifies systems: it produces understanding and reports for you to review.',
  'automations.schedule.mondays': 'Every Monday at 8:00',
  'automations.schedule.daily': 'Every day at 7:00',
  'automations.schedule.monthly': 'On the 1st of each month at 8:00',
  'automations.schedule.every6h': 'Every 6 hours',
  'automations.runs': 'Runs',
  'automations.runs.hide': 'Hide',
  'automations.runs.empty': 'No runs yet.',
  'automations.runNow': 'Run now',
  'automations.pause': 'Pause',
  'automations.resume': 'Resume',
  'automations.scheduled': 'Scheduled ({cron} · {timezone})',
  'automations.manual': 'Manual',
  'automations.action.SYNC_KNOWLEDGE_SOURCE': 'read the source again',
  'automations.action.RUN_ANALYSIS': 'analyse',
  'automations.action.GENERATE_REPORT': 'generate report',

  // ── Knowledge ────────────────────────────────────────────────────────────
  'knowledge.title': 'Your company knowledge',
  'knowledge.subtitle': 'Everything BusinessBrain knows comes from here. Nothing is made up: every answer comes from these documents.',
  'knowledge.connect.title': 'Connect another origin',
  'knowledge.connect.why':
    'Optional. Besides uploading documents, BusinessBrain can read a folder from your Drive or a label from your mail.',
  'knowledge.sources.add': 'Add a source',
  'knowledge.sources.cancel': 'Cancel',
  'knowledge.chain.title': 'How it works',
  'knowledge.chain.sources': 'Sources',
  'knowledge.chain.sourcesHint': 'Where the material arrives from: your computer, a website, Drive or Gmail.',
  'knowledge.chain.documents': 'Documents',
  'knowledge.chain.documentsHint': 'What has come in from those sources.',
  'knowledge.chain.understanding': 'Understanding',
  'knowledge.chain.understandingHint': 'Documents already read and ready to consult.',
  'knowledge.chain.answers': 'Answers',
  'knowledge.chain.answersHint': 'What you get when you ask, with its sources.',
  'knowledge.step.origin': 'Step 1 · Where it comes from',
  'knowledge.step.material': 'Step 2 · What has already come in',
  'knowledge.goAsk': 'Go and ask',
  'knowledge.collections.title': 'Collections',
  'knowledge.collections.why':
    'A collection sets who can see what. Every document must be in one: anything that belongs to none is seen by no one.',
  'knowledge.collections.empty': 'None yet.',
  'knowledge.collections.new': 'New collection',
  'knowledge.collections.placeholder': 'Sales',

  'knowledge.drive.title': 'Google Drive',
  'knowledge.drive.connected': 'connected',
  'knowledge.drive.folders': 'connected folders: {count}',
  'knowledge.drive.permission':
    'BusinessBrain will ask for READ-ONLY permission on your Drive. It never writes or changes anything, and you can withdraw it whenever you want.',
  'knowledge.drive.connect': 'Connect Google Drive',

  'knowledge.gmail.title': 'Gmail',
  'knowledge.gmail.active': 'active',
  'knowledge.gmail.unknownAccount': 'account not identified',
  'knowledge.gmail.labels': 'connected labels: {count}',
  'knowledge.gmail.revoked': 'revoked',
  'knowledge.gmail.revokedExplain':
    'Access to {account} was withdrawn. What had already been read is still available; to receive new email again, connect it once more.',
  'knowledge.gmail.thatAccount': 'that account',
  'knowledge.gmail.permission':
    'BusinessBrain will ask for READ-ONLY permission on your mail. It never sends or changes anything. Only the label you choose comes in, and it goes to a restricted collection: connecting Gmail does not open it to the whole company.',
  'knowledge.gmail.connect': 'Connect Gmail',
  'knowledge.disconnect': 'Disconnect',

  'knowledge.sources.title': 'Knowledge sources',
  'knowledge.sources.empty': 'None yet. Create one so you can upload documents.',
  'knowledge.sources.kind': 'Kind of source',
  'knowledge.sources.kind.upload': 'Documents I upload myself',
  'knowledge.sources.kind.website': 'A web page',
  'knowledge.sources.kind.drive': 'A Google Drive folder',
  'knowledge.sources.kind.gmail': 'A Gmail label',
  'knowledge.sources.new': 'New source',
  'knowledge.sources.namePlaceholder.website': 'Discount policy',
  'knowledge.sources.namePlaceholder.upload': 'Sales documents',
  'knowledge.sources.driveFolder': 'Drive folder',
  'knowledge.sources.driveFolderHint':
    'It will be read in full the first time; after that, only what changes.',
  'knowledge.sources.loadingFolders': 'Loading folders…',
  'knowledge.sources.gmailLabel': 'Gmail label',
  'knowledge.sources.gmailLabelHint':
    'Only email with this label comes in. Nothing outside it is synced.',
  'knowledge.sources.loadingLabels': 'Loading labels…',
  'knowledge.sources.chooseOne': 'Choose one…',
  'knowledge.sources.url': 'Web address',
  'knowledge.sources.urlHint':
    'It must be reachable from the internet. BusinessBrain will read it, and read it again whenever you ask.',
  'knowledge.sources.urlPlaceholder': 'https://example.com/discount-policy',
  'knowledge.sources.collection': 'Destination collection',
  'knowledge.sources.collectionHint':
    'Without a collection, what you upload will be seen by no one.',
  'knowledge.sources.collectionHintGmail':
    'Email requires a RESTRICTED collection: choose one the whole organisation cannot reach.',
  'knowledge.sources.create': 'Create source',

  'knowledge.source.lastSync': 'last read {date}',
  'knowledge.source.stats': 'new: {created} · updated: {updated}',
  'knowledge.source.statsFailed': ' · could not be read: {failed}',
  'knowledge.source.notRetrievable':
    '{count} cannot be consulted yet: read the source again',
  'knowledge.source.syncing': 'Reading…',
  'knowledge.source.readPage': 'Read the page',
  'knowledge.source.sync': 'Read again',
  'knowledge.source.uploading': 'Uploading…',
  'knowledge.source.upload': 'Upload document',
  'knowledge.upload.failed':
    'We could not upload this document. Check it and try again.',
  'knowledge.upload.unreadable': 'We could not read {file}. Check it and try again.',
  'knowledge.upload.indexed': '{file} is in and can be asked about.',
  'knowledge.upload.duplicate': '{file} was already here: it has not been duplicated.',

  'knowledge.items.title': 'Documents ({count})',
  'knowledge.items.empty': 'No document has come in yet.',
  'knowledge.items.column.title': 'Title',
  'knowledge.items.column.area': 'Area',
  'knowledge.items.column.status': 'Status',
  'knowledge.items.column.confidence': 'Reliability',
  'knowledge.items.column.indexed': 'Added',
  'knowledge.items.missingAtSource': 'no longer at its origin',

  // ── Settings: AI ─────────────────────────────────────────────────────────
  'ai.title': 'Artificial intelligence',
  'ai.ready': 'ready',
  'ai.notConfigured': 'not set up',
  'ai.adminOnly': 'Only an administrator can change this setting.',
  'ai.provider': 'Provider',
  'ai.replaceKey': 'Replace the key',
  'ai.keyFor': '{provider} key',
  'ai.yourProvider': 'your provider',
  'ai.keyHint':
    'It starts with "{prefix}". We check it before saving it and it is never shown again.',
  'ai.checking': 'Checking…',
  'ai.saveAndCheck': 'Save and check',
  'ai.removeKey': 'Remove my key',
  'ai.noKey': 'No key yet?',
  'ai.createKey': 'Create one in your {provider} account',
  'ai.billedToYou': 'Usage is billed to your account, not to BusinessBrain.',
  'ai.explanation.OWN_KEY':
    "BusinessBrain uses your company's key. Usage is billed to your account with the provider.",
  'ai.explanation.OWN_PROFILE_PLATFORM_KEY':
    'Your company has chosen a model but is using the key included with the service.',
  'ai.explanation.PLATFORM':
    'BusinessBrain is using the artificial intelligence included with the service. You can add your own key if you prefer to use your own account.',
  'ai.explanation.NOT_CONFIGURED':
    'Artificial intelligence still needs setting up. Without it BusinessBrain cannot read your documents or answer questions.',

  // ── Settings: AI usage ───────────────────────────────────────────────────
  'aiUsage.title': "Today's AI usage",
  'aiUsage.label': "Today's AI usage",
  'aiUsage.summary':
    'That is roughly {used} pages out of {limit} available today. The counter resets every day.',
  'aiUsage.reached':
    "You have reached today's limit. It is a safeguard so you do not get a surprise on your AI provider's bill.",
  'aiUsage.limit': 'Daily limit (pages)',
  'aiUsage.limitHint': 'Raise it if your team runs short.',
  'aiUsage.save': 'Save limit',
  'aiUsage.saved': 'Limit saved.',

  // ── Settings: organisation and people ────────────────────────────────────
  'settings.org.title': 'Organisation',
  'settings.org.name': 'Name',
  'settings.org.slug': 'Short name',
  'settings.org.yourRole': 'Your role',
  'settings.members.title': 'Members ({count})',
  'settings.members.column.name': 'Name',
  'settings.members.column.email': 'Email',
  'settings.members.column.role': 'Role',
  'settings.reliability.title': 'How demanding you are with your sources',
  'settings.reliability.explain':
    'Below this reliability level, BusinessBrain marks a document for someone to review. A number between 0 and 1: the higher, the stricter.',
  'settings.reliability.field': 'Required reliability',
  'settings.reliability.save': 'Save requirement',
  'settings.reliability.saved': 'Requirement saved.',
  'settings.invite.title': 'Invite someone',
  'settings.invite.explain':
    'An invitation link is created. Copy it and send it however you already talk. It will only work for that address.',
  'settings.invite.email': "The person's email",
  'settings.invite.emailPlaceholder': 'colleague@yourcompany.com',
  'settings.invite.role': 'Role',
  'settings.invite.roleHint':
    'Read only just reads; member can ask questions and curate.',
  'settings.invite.submit': 'Create invitation',
  'settings.invite.linkTitle':
    'Invitation link. It expires, and only works for the address given:',
  'settings.access.title': 'Who sees what',
  'settings.access.explain':
    'Access to a collection determines which understanding a person can read. If it does not cover ALL the collections a conclusion rests on, they do not see it — partial access denies.',
  'settings.access.noCollections':
    'Create a collection under Knowledge to get started.',
  'settings.access.nobody': 'Nobody has access yet.',
  'settings.access.grantTo': 'Grant access to',
  'settings.access.choose': 'Choose someone…',
  'settings.access.grant': 'Grant',
  'settings.access.revoke': 'revoke',
  'settings.access.revokeTitle': 'Revoke access',

  // ── Settings: privacy ────────────────────────────────────────────────────
  'privacy.title': 'Your data and artificial intelligence',
  'privacy.outgoing.title': 'What goes out to the AI provider you have set up',
  'privacy.outgoing.explain':
    'To read your documents and answer your questions, BusinessBrain sends the necessary text to the AI provider. This is exactly what goes out, and when:',
  'privacy.stored.title': 'What BusinessBrain stores',
  'privacy.pending.title': 'Still pending',
  'privacy.export.title': 'Take a copy with you',
  'privacy.export.explain':
    'A file with your documents, your conversations, your conclusions and your recommendations. It does not include your AI provider key or any credential.',
  'privacy.export.button': 'Download my data',
  'privacy.export.busy': 'Preparing…',
  'privacy.erase.title': 'Delete everything',
  'privacy.erase.explain':
    "This company's documents, conversations, conclusions, recommendations and settings are deleted. It cannot be undone. People's accounts are not deleted: they may belong to another company.",
  'privacy.erase.open': "I want to delete this company's data",
  'privacy.erase.confirmLabel': 'Type “{name}” to confirm',
  'privacy.erase.confirmHint': 'Exactly the same, including capitals and accents.',
  'privacy.erase.submit': 'Delete permanently',
  'privacy.erase.busy': 'Deleting…',

  // ── What goes out to the AI provider ─────────────────────────────────────
  'privacy.flow.ASK.what':
    'Your question and the extracts from your documents found to answer it.',
  'privacy.flow.ASK.trigger': 'Every time someone asks something.',
  'privacy.flow.ASK_STREAM.what':
    'The same as asking, when the answer is written out as it comes.',
  'privacy.flow.ASK_STREAM.trigger': 'Every time someone asks something.',
  'privacy.flow.CLASSIFY.what':
    'An extract from each document, to work out which area of the company it is about.',
  'privacy.flow.CLASSIFY.trigger': 'When a new document comes in.',
  'privacy.flow.EMBED.what':
    'The full text of each document, in pieces, so it can be searched later.',
  'privacy.flow.EMBED.trigger': 'When a new document comes in.',
  'privacy.flow.SEARCH.what':
    'The text of the search, so it can be compared against your documents.',
  'privacy.flow.SEARCH.trigger': 'Every time something is searched in your knowledge.',
  'privacy.flow.SYNTHESIS.what': 'The content of the documents being analysed.',
  'privacy.flow.SYNTHESIS.trigger': 'When an analysis is run.',
  'privacy.flow.PROPOSE.what':
    'The conclusions from the analysis, to draft a recommendation.',
  'privacy.flow.PROPOSE.trigger': 'When an analysis is run.',
  'privacy.flow.CONNECTION_TEST.what':
    'A test sentence, with none of your data, to check the key works.',
  'privacy.flow.CONNECTION_TEST.trigger': 'When the AI settings are saved.',

  'privacy.stored.DOCUMENTS.what':
    'The documents you upload or that are read from your sources',
  'privacy.stored.DOCUMENTS.detail':
    'Their full text, so answers can cite them. Kept inside BusinessBrain.',
  'privacy.stored.CONVERSATIONS.what': 'Questions and answers',
  'privacy.stored.CONVERSATIONS.detail':
    'So you can come back to an earlier conversation.',
  'privacy.stored.CONCLUSIONS.what': 'Conclusions and recommendations',
  'privacy.stored.CONCLUSIONS.detail':
    'With the evidence they come from, so they can always be checked.',
  'privacy.stored.PEOPLE.what': 'Who does what',
  'privacy.stored.PEOPLE.detail':
    'Name, email and the decisions each person makes about a recommendation.',
  'privacy.stored.AI_KEY.what': 'Your AI provider key',
  'privacy.stored.AI_KEY.detail':
    'Encrypted. It cannot be read from the interface and never comes back in a response.',

  'privacy.pending.DPA':
    'The data processing agreement with the AI provider depends on which one each company works with and on legal review. It is not provided from here yet.',
  'privacy.pending.RETENTION':
    'The retention period after leaving is not fixed: today, if you ask for deletion, it is deleted there and then.',

  // ── Platform audit ───────────────────────────────────────────────────────
  'audit.action.platform.users.listed': 'Viewed the list of people',
  'audit.action.platform.user.banned': 'Blocked an account',
  'audit.action.platform.user.unbanned': 'Unblocked an account',
  'audit.action.platform.organization.plan_changed': "Changed a company's plan",

  'audit.action.platform.access.requested': "Requested access to a company's data",
  'audit.action.platform.access.approved': "Approved access to their company's data",
  'audit.action.platform.access.used': "Viewed a company's data",
  'audit.action.platform.access.revoked': "Withdrew access to a company's data",

  'audit.target.User': 'account',
  'audit.target.Organization': 'company',
  'audit.target.PlatformAccessGrant': 'authorised access',

  'audit.detail.scope': 'scope',
  'audit.detail.reason': 'reason',
  'audit.detail.what': 'what was viewed',
  'audit.detail.expiresAt': 'expires',
  'audit.detail.requiresApproval': 'needs approval',

  'audit.value.METADATA': 'general data',
  'audit.value.DIAGNOSTICS': 'diagnostics',
  'audit.value.CONTENT': 'content',

  'audit.detail.previousStatus': 'previous state',
  'audit.detail.newStatus': 'new state',
  'audit.detail.from': 'before',
  'audit.detail.to': 'after',
  'audit.detail.page': 'page',
  'audit.detail.returned': 'people shown',

  'audit.value.ACTIVE': 'active',
  'audit.value.BANNED': 'blocked',
  'audit.value.FREE': 'Free',
  'audit.value.PRO': 'Professional',
  'audit.value.ENTERPRISE': 'Enterprise',

  // ── Two-step verification ─────────────────────────────────────────────────
  'mfa.title': 'Two-step verification',
  'mfa.explain':
    'On top of your password, we ask for a code that changes every few seconds on your phone. If someone gets hold of your password, they still cannot get in.',
  'mfa.status.on': 'On',
  'mfa.status.off': 'Off',
  'mfa.status.since': 'Turned on {date}',
  'mfa.status.pending':
    'You started setting this up and did not finish. Start again to complete it.',
  'mfa.status.remaining': 'You have {count} unused backup codes left.',
  'mfa.status.lowCodes':
    'You have {count} backup codes left. It is a good moment to generate new ones.',
  'mfa.activate': 'Turn on',
  'mfa.deactivate': 'Turn off',
  'mfa.setup.step1':
    'Open your authentication app on your phone (Google Authenticator, Microsoft Authenticator, or whichever you already use) and scan this code.',
  'mfa.setup.qrAlt': 'Code to scan with your app',
  'mfa.setup.manual': 'Cannot scan it? Type this key by hand:',
  'mfa.setup.step2': 'Type the 6-digit code your app is showing:',
  'mfa.setup.code': '6-digit code',
  'mfa.setup.confirm': 'Confirm and turn on',
  'mfa.setup.cancel': 'Leave it for later',
  'mfa.codes.title': 'Save these backup codes',
  'mfa.codes.explain':
    'If you ever lose your phone, each of these codes lets you in once. Print them or keep them somewhere safe: we will not be able to show them to you again.',
  'mfa.codes.understood': 'I have saved them',
  'mfa.codes.regenerate': 'Generate new codes',
  'mfa.codes.regenerateHint': 'Your previous codes will stop working.',
  'mfa.login.title': 'One more step',
  'mfa.login.explain': 'Type the code your authentication app is showing.',
  'mfa.login.code': 'Code',
  'mfa.login.hint':
    'Do not have your phone? Type one of your backup codes here.',
  'mfa.login.submit': 'Sign in',
  'mfa.remove.title': 'Remove verification from an administrator',
  'mfa.remove.explain':
    'If someone on your team has lost their phone and their backup codes, you can remove two-step verification for them. They will still need their password to sign in.',
  'mfa.remove.submit': 'Remove',
  'mfa.remove.done':
    'Done. We have emailed them, and they can now sign in with their password alone.',

  // ── Confirming identity before a sensitive action ─────────────────────────
  'reauth.title': 'Confirm it is you',
  'reauth.explain':
    'You are about to do something important and it has been a while since you signed in. Confirm it is still you.',
  'reauth.code': 'Code from your app',
  'reauth.password': 'Your password',
  'reauth.submit': 'Confirm',
  'reauth.cancel': 'Cancel',
  'reauth.done': 'Confirmed. You can carry on.',

  // ── Changing your password from inside ────────────────────────────────────
  'password.title': 'Password',
  'password.explain':
    'Changing it will sign you out on your other devices.',
  'password.new': 'New password',
  'password.repeat': 'Repeat it',
  'password.mismatch': 'The two passwords do not match.',
  'password.submit': 'Change password',
  'password.done': 'Password changed.',

  'audit.action.mfa.enabled': 'Turned on two-step verification',
  'audit.action.mfa.disabled': 'Turned off two-step verification',
  'audit.action.platform.user.mfa_removed':
    'Removed two-step verification from an account',
  'audit.detail.targetName': 'on',
  'audit.detail.organizations': 'companies affected',
  'audit.detail.recoveryCodesIssued': 'backup codes issued',
  'audit.detail.method': 'using',
  'audit.detail.sensitiveAction': 'attempted action',
  'audit.detail.otherSessionsRevoked': 'signed out other devices',
  'audit.detail.remainingCodes': 'codes left',
  'audit.detail.requestedById': 'requested by',

  // ══ OPERATIONS PANEL ═══════════════════════════════════════════════════════
  'platform.chrome.badge': 'Operations',
  'platform.chrome.boundary':
    'You administer BusinessBrain. Each company’s data stays theirs: reading it takes an access grant with a stated reason, an end date, and a record the client can see.',

  'platform.nav.assistant': 'Assistant',
  'platform.nav.account': 'My account',

  // ── Operations assistant ──────────────────────────────────────────────────
  'platform.assistant.title': 'Operations assistant',
  'platform.assistant.subtitle':
    'Ask about the state of the platform and your clients. It consults exactly what you can consult, with your own permissions, and it executes nothing.',
  'platform.assistant.startHere': 'Where to start',
  'platform.assistant.startHint':
    'Type your question below, or try one of these.',
  'platform.assistant.example.health': 'How is the platform doing right now?',
  'platform.assistant.example.quiet':
    'Which companies have not uploaded anything in a while?',
  'platform.assistant.example.recent':
    'What has been done from operations this week?',
  'platform.assistant.ask': 'Ask',
  'platform.assistant.placeholder':
    'For example: which clients are on the free plan with more than a hundred documents?',
  'platform.assistant.thinking': 'Looking it up…',
  'platform.assistant.failed':
    'It could not answer. Try again in a moment.',
  'platform.assistant.neverExecutes':
    'The assistant proposes; executing is up to you.',
  'platform.assistant.consulted': 'It looked at',
  'platform.assistant.consultedNothing':
    'It looked at nothing: this answer is not backed by data.',
  'platform.assistant.outcome.NEEDS_GRANT': 'No access granted',
  'platform.assistant.outcome.UNKNOWN_TOOL': 'It cannot do that',
  'platform.assistant.currentAccess': 'Your open access',
  'platform.assistant.currentAccessHint':
    'The assistant only reaches what you have been granted right now.',
  'platform.assistant.noAccess':
    'None. It can answer about the platform, but not about what is inside a company.',
  'platform.assistant.canConsult': 'What it can look up',
  'platform.assistant.needsScope': 'Needs access of type “{scope}”.',
  'platform.assistant.cannot': 'What it cannot do',
  'platform.assistant.cannotHint':
    'It cannot read any company’s documents, change anything, grant access, or use someone else’s. It is not that it is denied: those capabilities do not exist.',
  'platform.assistant.asWho': 'Looking things up as {who}.',
  'platform.assistant.tool.platform_overview':
    'The general state of the platform',
  'platform.assistant.tool.list_organizations': 'The list of companies',
  'platform.assistant.tool.organization_metadata':
    'A company’s general data',
  'platform.assistant.tool.organization_diagnostics':
    'A company’s diagnostics',
  'platform.assistant.tool.my_access': 'Your open access',
  'platform.assistant.tool.platform_audit': 'The operations log',
  'platform.account.title': 'My account',
  'platform.account.subtitle': 'Two-step verification is required to administer BusinessBrain: without it you will not be able to use the rest of the panel.',
  'platform.nav.overview': 'Home',
  'platform.nav.organizations': 'Companies',
  'platform.nav.users': 'People',
  'platform.nav.access': 'My access',
  'platform.nav.audit': 'Log',

  'platform.state.loading': 'Loading…',
  'platform.state.empty': 'Nothing to show yet.',
  'platform.state.error': 'This information could not be loaded.',
  'platform.state.errorHint':
    'It may be a passing connection problem. Try again; if it keeps failing, check the service status.',
  'platform.state.retry': 'Try again',

  'platform.pagination.label': 'Pagination',
  'platform.pagination.previous': 'Previous',
  'platform.pagination.next': 'Next',
  'platform.pagination.position': 'Page {page} of {pages}',

  'platform.overview.title': 'Platform status',
  'platform.overview.subtitle':
    'What is open right now, and how big the product is. None of this comes from any client’s documents.',
  'platform.overview.openAccess': 'Open access to client data',
  'platform.overview.openAccessHint':
    'The first thing worth checking each day: what is still open and no longer needed.',
  'platform.overview.noOpenAccess':
    'You have no open access to any company’s data.',
  'platform.overview.seeAll': 'See all',
  'platform.overview.organizations': 'Companies',
  'platform.overview.people': 'People',
  'platform.overview.blocked': 'Blocked accounts',
  'platform.overview.blockedHint': 'Cannot sign in',
  'platform.overview.byPlan': 'Companies by plan',

  'platform.organizations.title': 'Companies',
  'platform.organizations.subtitle':
    'Your client base. The counts say how much material each one handles; seeing what it contains takes an access grant.',
  'platform.organizations.search': 'Search',
  'platform.organizations.searchPlaceholder': 'Name or identifier',
  'platform.organizations.searchScope':
    'Search only covers the companies on this page. Change page to search the rest.',
  'platform.organizations.plan': 'Plan',
  'platform.organizations.allPlans': 'All',
  'platform.organizations.none': 'There are no companies yet.',
  'platform.organizations.noMatches': 'No company matches your search.',
  'platform.organizations.column.name': 'Company',
  'platform.organizations.column.plan': 'Plan',
  'platform.organizations.column.people': 'People',
  'platform.organizations.column.documents': 'Documents',
  'platform.organizations.column.sources': 'Sources',
  'platform.organizations.column.since': 'Client since',

  'platform.plan.FREE': 'Free',
  'platform.plan.PRO': 'Professional',
  'platform.plan.ENTERPRISE': 'Enterprise',
  'platform.plan.change': 'Change plan',
  'platform.plan.apply': 'Apply',
  'platform.plan.confirmTitle': 'Change this company’s plan',
  'platform.plan.confirmBody':
    'The plan will go from “{from}” to “{to}”. The change is immediate and affects the client’s account.',

  'platform.organization.back': '← Companies',
  'platform.organization.subtitle': 'Identifier: {slug}',
  'platform.organization.plan': 'Plan',
  'platform.organization.since': 'Client since',
  'platform.organization.theirData': 'Their data',
  'platform.organization.theirDataHint':
    'From here on, everything belongs to the company. Each section needs its own access grant, with a reason and an end date, and the client can see who came in and when.',

  'platform.scope.METADATA.name': 'General data',
  'platform.scope.METADATA.explains':
    'How many documents and collections they have, which sources they connected and whether those are syncing. Not one line of what their documents say.',
  'platform.scope.METADATA.request': 'Request access to general data',
  'platform.scope.METADATA.confirmTitle': 'Request access to general data',
  'platform.scope.METADATA.confirmBody':
    'You will be able to see how many documents and sources this company has and what state they are in. You will not see the content of any document. Access lasts 24 hours and you ({who}) are requesting it; the company will see it in their log with the reason you write.',

  'platform.scope.DIAGNOSTICS.name': 'Diagnostics',
  'platform.scope.DIAGNOSTICS.explains':
    'The technical errors: which sync failed and why. It may name a file so it can be identified, never its content.',
  'platform.scope.DIAGNOSTICS.request': 'Request access to diagnostics',
  'platform.scope.DIAGNOSTICS.confirmTitle': 'Request access to diagnostics',
  'platform.scope.DIAGNOSTICS.confirmBody':
    'You will be able to see this company’s technical errors, including the name of the file that failed when that is needed to identify it. You will not see the content of any document. Access lasts 24 hours and you ({who}) are requesting it; the company will see it in their log with the reason you write.',

  'platform.scope.CONTENT.name': 'Content',
  'platform.scope.CONTENT.explains':
    'The text of the company’s documents. It is what they wrote, which is why whoever answers for the company has to approve it.',
  'platform.scope.CONTENT.request': 'Request access to content',
  'platform.scope.CONTENT.confirmTitle':
    'Request access to this company’s content',
  'platform.scope.CONTENT.confirmBody':
    'You are about to request permission to READ this company’s documents: contracts, reports, emails, whatever they uploaded. The request stays pending and nothing opens until whoever answers for the company approves it. If they do, access lasts at most 72 hours, every document you open is logged one by one, and the client can see it. You ({who}) are requesting it with the reason you write.',

  'platform.scope.open': 'Access active',
  'platform.scope.closed': 'No access',
  'platform.scope.awaitingOwner': 'Waiting on the company',
  'platform.scope.expires': 'Expires {when}',
  'platform.scope.reasonGiven': 'Reason: {reason}',
  'platform.scope.revoke': 'Withdraw this access',
  'platform.scope.revokeTitle': 'Withdraw access',
  'platform.scope.revokeConsequence':
    'You will stop being able to consult “{scope}” for this company immediately. You can request it again when needed.',
  'platform.scope.pendingExplain':
    'You requested this access and {organization} has not approved it yet. Until they do, you cannot consult anything.',
  'platform.scope.pendingExpires':
    'The request expires {when} if nobody answers.',
  'platform.scope.reasonLabel': 'Why you need it',
  'platform.scope.reasonHint':
    'The company will read this in their log. Explain it the way you would explain it to them.',

  'platform.grant.status.PENDING': 'Awaiting approval',
  'platform.grant.status.ACTIVE': 'Active',
  'platform.grant.status.REVOKED': 'Withdrawn',
  'platform.grant.status.EXPIRED': 'Expired',
  'platform.grant.expiredAlready': 'already expired',

  'platform.metadata.collections': 'Collections',
  'platform.metadata.insights': 'Findings',
  'platform.metadata.source': 'Source',
  'platform.metadata.state': 'State',
  'platform.metadata.lastSync': 'Last sync',

  'platform.diagnostics.failingSources': 'Sources with errors',
  'platform.diagnostics.recentJobs': 'Recent syncs',
  'platform.diagnostics.failedAnalyses': 'Failed analyses',
  'platform.diagnostics.state': 'State',
  'platform.diagnostics.detail': 'Technical detail',
  'platform.diagnostics.when': 'When',

  'platform.content.title': 'Document',
  'platform.content.state': 'State',
  'platform.content.indexed': 'Indexed',
  'platform.content.read': 'Open',
  'platform.content.close': 'Close',
  'platform.content.readLogged':
    'Opening this document has been logged, and the company can see it.',

  'platform.grantHistory.title': 'Access history for this company',
  'platform.grantHistory.hint':
    'The same thing the client sees from their account. Includes expired and withdrawn ones.',
  'platform.grantHistory.none':
    'Access to this company has never been requested.',
  'platform.grantHistory.scope': 'Scope',
  'platform.grantHistory.state': 'State',
  'platform.grantHistory.reason': 'Reason',
  'platform.grantHistory.requestedBy': 'Requested by',
  'platform.grantHistory.requestedAt': 'Requested',
  'platform.grantHistory.expires': 'Expires',

  'platform.users.title': 'People',
  'platform.users.subtitle':
    'Accounts across all client companies. It exists to answer “I can’t sign in”, not for anything else.',
  'platform.users.readLogged':
    'Consulting this list is logged: these are personal details of client companies’ employees.',
  'platform.users.search': 'Search by name or email',
  'platform.users.none': 'There are no accounts to show.',
  'platform.users.isAdmin': 'Operations',
  'platform.users.column.name': 'Name',
  'platform.users.column.email': 'Email',
  'platform.users.column.state': 'State',
  'platform.users.column.mfa': 'Two-step verification',
  'platform.users.column.lastSeen': 'Last activity',
  'platform.users.status.ACTIVE': 'Active',
  'platform.users.status.BANNED': 'Blocked',
  'platform.users.mfaOn': 'On',
  'platform.users.mfaOff': 'Off',

  'platform.user.back': '← People',
  'platform.user.account': 'The account',
  'platform.user.since': 'Registered',
  'platform.user.organizations': 'Companies they belong to',
  'platform.user.noOrganizations': 'They do not belong to any company.',
  'platform.user.noOrganizationsAdmin':
    'None, and they cannot belong to any: this is a BusinessBrain operations account.',
  'platform.user.actions': 'Actions on this account',
  'platform.user.actionsHint':
    'All of them are logged, and some will ask you to confirm your identity.',
  'platform.user.cannotActOnAdmin':
    'This is a BusinessBrain operations account. It cannot be blocked from here: that would leave the product with nobody able to unblock it.',
  'platform.user.ban': 'Block the account',
  'platform.user.banTitle': 'Block this account',
  'platform.user.banBody':
    'This person will stop being able to sign in immediately, and their open sessions will be cut. Their company and their documents are untouched. You can unblock them later.',
  'platform.user.unban': 'Unblock the account',
  'platform.user.unbanTitle': 'Unblock this account',
  'platform.user.unbanBody':
    'This person will be able to sign in again with their usual password.',
  'platform.user.removeMfa': 'Remove two-step verification',
  'platform.user.removeMfaTitle': 'Remove two-step verification',
  'platform.user.removeMfaBody':
    'This person will no longer need the code from their phone to sign in. It does NOT give you access to their account: their password is still required, and it is neither read nor changed here. We will email them, and whoever answers for their company too.',
  'platform.user.removeMfaReason': 'Why it needs removing',
  'platform.user.removeMfaReasonHint':
    'It will appear in the email that person receives and in the log. At least 10 characters.',

  'platform.myAccess.title': 'My access',
  'platform.myAccess.subtitle':
    'What you have open right now on other companies’ data, and what you have had before.',
  'platform.myAccess.notMembership':
    'Having access is not belonging to that company. These are temporary read permissions over data that is not yours, and they are best withdrawn as soon as they stop being needed.',
  'platform.myAccess.open': 'Open now',
  'platform.myAccess.noneOpen': 'You have no open access.',
  'platform.myAccess.expires': 'Expires {when}',
  'platform.myAccess.requestedAt': 'Requested on {when}',
  'platform.myAccess.approvedBy': 'approved by {who}',
  'platform.myAccess.finished': 'Finished',
  'platform.myAccess.finishedHint':
    'Access that expired or that you withdrew. Kept because it is part of the history the client can consult.',

  'platform.audit.title': 'Operations log',
  'platform.audit.subtitle':
    'Everything done from BusinessBrain operations. Each company’s own activity does not appear here: it is theirs.',
  'platform.audit.filterByAction': 'Filter by action',
  'platform.audit.allActions': 'All actions',
  'platform.audit.none': 'No action has been logged yet.',
  'platform.audit.system': 'The system',

  'platform.confirm.reason': 'Reason',
  'platform.confirm.reasonHint':
    'It will stay in the log. At least 10 characters.',
  'platform.confirm.audited':
    'This action will be logged with your name, the date and the reason.',
  'platform.confirm.cancel': 'Cancel',
  'platform.confirm.done': 'Done. It has been logged.',
  'platform.confirm.denied':
    'You do not have permission for this, or the action is no longer possible in this state.',
  'platform.confirm.invalid':
    'Something is missing or invalid. Check what you wrote.',
  'platform.confirm.failed':
    'It could not be completed. Try again in a moment.',
};

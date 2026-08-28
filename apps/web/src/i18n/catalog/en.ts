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

  // ── Navigation ───────────────────────────────────────────────────────────
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
  'status.knowledgeItem.PENDING': 'queued',
  'status.knowledgeItem.PROCESSING': 'processing',
  'status.knowledgeItem.INDEXED': 'ready',
  'status.knowledgeItem.FAILED': 'has problems',
  'status.knowledgeItem.SUPERSEDED': 'earlier version',
  'status.knowledgeItem.DELETED': 'deleted',

  'status.insightType.PATTERN': 'pattern',
  'status.insightType.ANOMALY': 'deviation',
  'status.insightType.RISK': 'risk',
  'status.insightType.OPPORTUNITY': 'opportunity',

  'status.freshness.FRESH': 'up to date',
  'status.freshness.STALE': 'changed since it was worked out',
  'status.freshness.UNRESOLVABLE': 'can no longer be checked',

  'status.run.PENDING': 'queued',
  'status.run.RUNNING': 'running',
  'status.run.SUCCESS': 'fine',
  'status.run.FAILED': 'with errors',
  'status.run.PARTIAL': 'partial',
  'status.run.CANCELLED': 'cancelled',

  'status.connection.PENDING': 'not synced yet',
  'status.connection.CONNECTED': 'connected',
  'status.connection.SYNCING': 'syncing',
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
  'dashboard.steps.sync.action': 'Sync so it can learn',
  'dashboard.steps.sync.why':
    'Until something comes in, BusinessBrain knows nothing about your company.',
  'dashboard.steps.ask.action': 'Ask it a question',
  'dashboard.steps.ask.why':
    'It will answer with what it knows and tell you which documents it came from.',
  'dashboard.steps.analysis.action': 'Run an analysis',
  'dashboard.steps.analysis.why':
    'It looks for risks, deviations and opportunities in what it already knows.',

  // ── Understanding ────────────────────────────────────────────────────────
  'common.confidence': 'confidence {value}',
  'insights.title': 'Conclusions ({count})',
  'insights.empty':
    'There are no conclusions within your reach. There may be no analysis yet, or you may not have access to the collections they rest on.',
  'insight.badge.freshEvidence': 'evidence intact',
  'insight.badge.evidenceChanged': 'its evidence changed',
  'insight.badge.evidenceUnresolvable': 'evidence unresolvable',
  'insight.badge.disputed': 'approval disputed',
  'insight.badge.inherited': 'approved on an earlier version',
  'insight.badge.curated': 'approved by a person',

  // ── Analysis ─────────────────────────────────────────────────────────────
  'analysis.title': 'Analysis',
  'analysis.needsAdmin':
    'Running and viewing analyses needs administrator permissions in this organisation.',
  'analysis.run.title': 'Run an analysis',
  'analysis.run.button': 'Analyse now',
  'analysis.run.busy': 'Analysing…',
  'analysis.run.explain':
    'The engine goes through the indexed knowledge, works out conclusions and reconciles them with what it already believed. If a conclusion changes, the previous one is not deleted: it stays as a superseded version.',
  'analysis.result.summary':
    '{created} new conclusion(s) · {known} already known · {candidates} candidate(s) evaluated.',
  'analysis.result.seeInsights': 'See understanding',
  'analysis.result.proposals': '{count} recommendation(s) to review',
  'analysis.runs.title': 'Runs',
  'analysis.runs.empty': 'No analysis has been run yet.',
  'analysis.runs.column.status': 'Status',
  'analysis.runs.column.origin': 'Origin',
  'analysis.runs.column.started': 'Started',
  'analysis.runs.column.finished': 'Finished',
  'analysis.trigger.automatic': 'automatic',
  'analysis.trigger.manual': 'manual',

  // ── Objectives ───────────────────────────────────────────────────────────
  'objectives.declare.title': 'Declare an objective',
  'objectives.declare.why':
    'Without a confirmed objective, the system can tell you what is happening, but not whether it is a risk or an opportunity for your company.',
  'objectives.field': 'Objective',
  'objectives.placeholder': 'Commercial margin must not fall below 30%.',
  'objectives.declare': 'Declare',
  'objectives.title': 'Objectives ({count})',
  'objectives.empty': 'None declared yet.',
  'objectives.column.statement': 'Objective',
  'objectives.column.status': 'Status',
  'objectives.column.origin': 'Origin',
  'objectives.column.declared': 'Declared',
  'objectives.status.confirmed': 'confirmed',
  'objectives.status.inferred': 'proposed by the system',
  'objectives.origin.person': 'a person',
  'objectives.origin.inferred': 'inferred',
  'objectives.confirm': 'Confirm',
  'objectives.discard': 'Discard',

  // ── Asking ───────────────────────────────────────────────────────────────
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
  'ask.indexedAt': 'indexed {date}',

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
  'recs.evidence.show': 'See evidence',
  'recs.evidence.hide': 'Hide evidence',
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
  'insight.notFound': 'Not found.',
  'insight.title': 'Conclusion',
  'insight.curatedOwn': 'Approved on this very version',
  'insight.curatedInherited': 'Approved on an earlier version of this belief',
  'insight.curatedOn': 'on {date}.',
  'insight.curationDisputed':
    'Later evidence contradicts what was approved.',
  'insight.mattersBecause': 'It matters because:',
  'insight.evidence': 'Evidence ({count})',
  'insight.decide.title': 'Your decision',
  'insight.decide.explain':
    'What you decide takes priority over any later automatic recalculation, until you revoke it. Dismissing it takes it out of everyday reading without deleting anything.',
  'insight.decide.field': 'Decision',
  'insight.decide.confirm': 'I confirm it',
  'insight.decide.correct': 'I correct it',
  'insight.decide.dismiss': 'I dismiss it',
  'insight.decide.comment': 'Comment (optional)',
  'insight.decide.submit': 'Record',
  'insight.decide.done': 'Decision recorded.',
  'insight.history.title': 'How this belief has changed',
  'insight.history.empty': 'No version is visible within your reach.',
  'insight.history.current': 'current version',
  'insight.history.superseded': 'superseded',
  'insight.history.evidenceCount': '{count} piece(s) of evidence',
  'insight.history.confidenceRose': 'Confidence rose {delta} because:',
  'insight.history.confidenceFell': 'Confidence fell {delta} because:',
  'insight.history.outOfScope':
    'And {count} more change(s) outside your reach, which we cannot detail.',
  'insight.history.hiddenVersions':
    'There are {count} version(s) of this belief you cannot see with your current reach.',
  'insight.change.ENTERED': 'new evidence came in',
  'insight.change.LEFT': 'it stopped supporting it',
  'insight.change.CONTRADICTED': 'it contradicted it',
  'insight.change.SUPERSEDED_EVIDENCE': 'its source was replaced',

  // ── Reports ──────────────────────────────────────────────────────────────
  'reports.title': 'Reports ({count})',
  'reports.empty': 'None yet.',
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
  'reports.new.submit': 'Create report',
  'reports.sections': '{count} section(s)',
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
  'automations.title': 'Automations ({count})',
  'automations.empty':
    'None yet. Create one so the system analyses your knowledge on its own.',
  'automations.new.title': 'New automation',
  'automations.new.name': 'Name',
  'automations.new.namePlaceholder': 'Weekly sweep',
  'automations.new.when': 'When',
  'automations.new.timezone': 'Time zone: {timezone}',
  'automations.new.whatItDoes': 'What it will do',
  'automations.new.reread': 'Read again',
  'automations.new.sourceLabel': 'Source to sync',
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
  'automations.lastRun': 'last run {date}',
  'automations.nextRun': 'next {date}',
  'automations.action.SYNC_KNOWLEDGE_SOURCE': 'read the source again',
  'automations.action.RUN_ANALYSIS': 'analyse',
  'automations.action.GENERATE_REPORT': 'generate report',

  // ── Knowledge ────────────────────────────────────────────────────────────
  'knowledge.collections.title': 'Collections',
  'knowledge.collections.why':
    'A collection sets who can see what. Every document must be in one: anything that belongs to none is seen by no one.',
  'knowledge.collections.empty': 'None yet.',
  'knowledge.collections.new': 'New collection',
  'knowledge.collections.placeholder': 'Sales',

  'knowledge.drive.title': 'Google Drive',
  'knowledge.drive.connected': 'connected',
  'knowledge.drive.folders': '{count} folder(s) syncing',
  'knowledge.drive.permission':
    'BusinessBrain will ask for READ-ONLY permission on your Drive. It never writes or changes anything, and you can withdraw it whenever you want.',
  'knowledge.drive.connect': 'Connect Google Drive',

  'knowledge.gmail.title': 'Gmail',
  'knowledge.gmail.active': 'active',
  'knowledge.gmail.unknownAccount': 'account not identified',
  'knowledge.gmail.labels': '{count} label(s) syncing',
  'knowledge.gmail.revoked': 'revoked',
  'knowledge.gmail.revokedExplain':
    'Access to {account} was withdrawn. What had already been read is still available; to receive new email again, connect it once more.',
  'knowledge.gmail.thatAccount': 'that account',
  'knowledge.gmail.permission':
    'BusinessBrain will ask for READ-ONLY permission on your email. It never sends or changes anything. Only the label you choose comes in, and indexed email goes into a restricted collection: connecting Gmail does not make it visible to the whole organisation.',
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

  'knowledge.source.lastSync': 'last sync {date}',
  'knowledge.source.stats': '{created} new, {updated} updated',
  'knowledge.source.statsFailed': ', {failed} with errors',
  'knowledge.source.notRetrievable':
    '{count} not indexed for search: sync again',
  'knowledge.source.syncing': 'Syncing…',
  'knowledge.source.readPage': 'Read the page',
  'knowledge.source.sync': 'Sync',
  'knowledge.source.uploading': 'Uploading…',
  'knowledge.source.upload': 'Upload document',
  'knowledge.upload.failed':
    'We could not upload this document. Check it and try again.',
  'knowledge.upload.unreadable': 'We could not read {file}. Check it and try again.',
  'knowledge.upload.indexed': '{file} indexed and ready to ask about.',
  'knowledge.upload.duplicate': '{file} was already here: it has not been duplicated.',

  'knowledge.items.title': 'Documents ({count})',
  'knowledge.items.empty': 'No documents indexed yet.',
  'knowledge.items.column.title': 'Title',
  'knowledge.items.column.area': 'Area',
  'knowledge.items.column.status': 'Status',
  'knowledge.items.column.confidence': 'Confidence',
  'knowledge.items.column.indexed': 'Indexed',
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
  'settings.org.slug': 'Identifier',
  'settings.org.yourRole': 'Your role',
  'settings.members.title': 'Members ({count})',
  'settings.members.column.name': 'Name',
  'settings.members.column.email': 'Email',
  'settings.members.column.role': 'Role',
  'settings.reliability.title': 'How demanding you are with your sources',
  'settings.reliability.explain':
    'Below this reliability level, BusinessBrain will flag a document for someone to review. A number between 0 and 1: the higher, the stricter.',
  'settings.reliability.field': 'Reliability threshold',
  'settings.reliability.save': 'Save threshold',
  'settings.reliability.saved': 'Threshold saved.',
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
    'Their full text, so answers can cite them. Stored in the BusinessBrain database.',
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
};

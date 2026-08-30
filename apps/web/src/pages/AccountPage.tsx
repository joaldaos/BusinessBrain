import { LanguagePicker } from '../components/LanguagePicker';
import { SecurityCard } from '../components/SecurityCard';
import { PageHeader, Section, usePageTitle } from '../components/ui';
import { useAuth } from '../auth';
import { useT } from '../i18n';

/**
 * Mi cuenta: lo que pertenece a la PERSONA.
 *
 * ## Por qué esto es una pantalla aparte y no una sección
 *
 * Hasta la Fase 8, el idioma, la contraseña y la verificación en dos pasos vivían en la misma
 * página que el plan de IA, los miembros y el borrado de datos de la empresa. Eran doce
 * bloques de tres mil píxeles en los que convivían dos cosas que no tienen nada que ver:
 *
 * - Lo que es **tuyo** viaja contigo. Si mañana dejas esta empresa y entras en otra, tu
 *   contraseña, tu segundo factor y tu idioma van contigo.
 * - Lo que es **de la empresa** se queda, y lo ve —y lo cambia— todo su equipo.
 *
 * Mezclarlas hacía que nadie supiera a qué afectaba cada control. Alguien que cambiaba el
 * idioma podía creer que lo estaba cambiando para toda la empresa; alguien que subía el tope
 * de gasto podía creer que era suyo.
 *
 * La separación no es visual: es conceptual, y por eso son dos entradas del menú.
 */
export function AccountPage() {
  const { user } = useAuth();
  const t = useT();
  usePageTitle('nav.account');

  return (
    <>
      <PageHeader
        title={t('account.title')}
        description={t('account.subtitle')}
      />

      <div className="space-y-4">
        <Section
          title={t('account.who')}
          description={t('account.whoHint')}
        >
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <div>
              <dt className="t-micro text-muted">{t('login.name')}</dt>
              <dd className="mt-1 t-body text-ink">{user?.name}</dd>
            </div>
            <div>
              <dt className="t-micro text-muted">{t('login.email')}</dt>
              <dd className="mt-1 t-body text-ink">{user?.email}</dd>
            </div>
          </dl>
        </Section>

        <Section
          title={t('settings.language')}
          description={t('settings.languageHint')}
        >
          <LanguagePicker compact />
        </Section>

        {/*
          La verificación en dos pasos y la contraseña. Es lo único de todo el producto que
          protege a la persona aunque cambie de empresa.
        */}
        <SecurityCard />
      </div>
    </>
  );
}

import { useState, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { useT } from "../i18n";
import { useSensitiveAction } from "../components/ReauthDialog";
import { ActionButton } from "./ui";

/**
 * El paso previo a cualquier acción que afecte a una empresa o a la cuenta de otra persona.
 *
 * ## Por qué existe, y qué NO es
 *
 * No es un `window.confirm` con otro nombre. Un diálogo que dice "¿Estás seguro?" no informa de
 * nada: quien lo lee ya cree estar seguro, y lo pulsa. Este enseña, antes de que haya nada que
 * confirmar, **qué va a ocurrir exactamente y sobre quién**, y —cuando corresponde— obliga a
 * escribir el motivo que quedará en la traza.
 *
 * ## Las cuatro cosas que garantiza
 *
 * 1. **Nada ocurre por un clic accidental.** El botón de la pantalla abre esto; ejecutar exige
 *    un segundo gesto deliberado sobre un texto que describe la consecuencia.
 * 2. **La reautenticación es la del sistema, no otra.** Si el backend responde que hace falta
 *    confirmar la identidad, aparece el diálogo de la Fase 4 —el mismo que usa el producto de
 *    cliente— y la acción se reintenta sola al confirmarla. No hay aquí ninguna lógica de
 *    seguridad: quien decide es `RecentAuthGuard`.
 * 3. **El motivo se exige donde el backend lo exige.** Se valida la longitud antes de llamar
 *    para no gastar una llamada en un 400 evitable, pero quien decide sigue siendo el DTO.
 * 4. **El resultado se ve, y se dice que quedó auditado.** Una acción sensible que solo cierra
 *    un diálogo deja a quien la hizo sin saber si ocurrió.
 */
export function ConfirmAction({
  trigger,
  title,
  /** Qué va a pasar exactamente. En prosa, no en jerga. */
  consequence,
  /** Sobre quién o sobre qué. Se enseña destacado: es lo que se lee mal cuando hay prisa. */
  subject,
  confirmLabel,
  variant = "secondary",
  requiresReason,
  reasonLabel,
  reasonHint,
  onConfirm,
  onDone,
}: {
  trigger: (open: () => void) => ReactNode;
  title: string;
  consequence: string;
  subject?: string;
  confirmLabel: string;
  variant?: "primary" | "danger" | "secondary";
  requiresReason?: boolean;
  reasonLabel?: string;
  reasonHint?: string;
  onConfirm: (reason: string) => Promise<void>;
  onDone?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState<"denied" | "invalid" | "unknown" | null>(
    null,
  );
  const sensitive = useSensitiveAction();

  const cerrar = () => {
    setOpen(false);
    setReason("");
    setFailed(null);
  };

  const ejecutar = async () => {
    setBusy(true);
    setFailed(null);
    try {
      await sensitive.run(async () => {
        await onConfirm(reason.trim());
        setDone(true);
        setOpen(false);
        setReason("");
        onDone?.();
      });
    } catch (error) {
      // El mensaje del backend NO se enseña: está en un idioma fijo y escrito para quien lee
      // un registro. Lo que se traduce es la CATEGORÍA, que es lo que dice qué hacer ahora.
      setFailed(
        error instanceof ApiError && error.status === 400
          ? "invalid"
          : error instanceof ApiError && error.status === 403
            ? "denied"
            : "unknown",
      );
    } finally {
      setBusy(false);
    }
  };

  const motivoCorto = requiresReason && reason.trim().length < 10;

  return (
    <>
      {trigger(() => {
        setDone(false);
        setOpen(true);
      })}

      {done && !open && (
        <p className="mt-2 text-[12.5px] text-emerald-700">
          {t("platform.confirm.done")}
        </p>
      )}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="mt-3 rounded-lg border border-amber-300 bg-amber-50/60 p-4"
        >
          <h3 className="text-[13.5px] font-semibold text-ink">{title}</h3>

          {subject && (
            <p className="mt-2 rounded border border-amber-200 bg-surface px-3 py-2 text-[13px] font-medium text-ink">
              {subject}
            </p>
          )}

          <p className="mt-2 text-[12.5px] leading-relaxed text-ink/80">
            {consequence}
          </p>

          {requiresReason && (
            <label className="mt-3 block">
              <span className="text-[12px] font-medium text-ink">
                {reasonLabel ?? t("platform.confirm.reason")}
              </span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                className="mt-1 w-full rounded border border-line bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
              />
              <span className="mt-1 block text-[11.5px] text-muted">
                {reasonHint ?? t("platform.confirm.reasonHint")}
              </span>
            </label>
          )}

          {/*
            Se dice ANTES de ejecutar, no después. Saber que va a quedar registrado es parte de
            la decisión, no una consecuencia que se descubre luego.
          */}
          <p className="mt-3 text-[11.5px] text-muted">
            {t("platform.confirm.audited")}
          </p>

          {failed && (
            <p role="alert" className="mt-2 text-[12.5px] text-red-700">
              {t(
                failed === "invalid"
                  ? "platform.confirm.invalid"
                  : failed === "denied"
                    ? "platform.confirm.denied"
                    : "platform.confirm.failed",
              )}
            </p>
          )}

          {/* El diálogo de la Fase 4. No hay otro. */}
          {sensitive.dialog && <div className="mt-3">{sensitive.dialog}</div>}

          <div className="mt-4 flex items-center gap-2">
            <ActionButton
              variant={variant}
              onClick={() => void ejecutar()}
              disabled={busy || motivoCorto}
            >
              {busy ? t("common.moment") : confirmLabel}
            </ActionButton>
            <button
              type="button"
              onClick={cerrar}
              className="text-[12.5px] text-muted underline"
            >
              {t("platform.confirm.cancel")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

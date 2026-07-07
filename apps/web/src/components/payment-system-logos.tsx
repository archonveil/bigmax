/**
 * Логотипы платёжных систем (Visa, Mastercard, Uzcard, Humo) — требование
 * банка-эквайера (Uniteller): логотипы международных платёжных систем должны
 * быть размещены на сайте. Inline-SVG без внешних ресурсов; рендерится в
 * футере и на странице «Оплата и возврат» (/payment).
 */

interface PaymentSystemLogosProps {
  className?: string;
}

const badgeClass = "flex h-9 w-16 items-center justify-center rounded-md border bg-white shadow-sm";

export function PaymentSystemLogos({ className }: PaymentSystemLogosProps): JSX.Element {
  return (
    <ul className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <li className={badgeClass} title="Visa">
        <svg role="img" aria-label="Visa" viewBox="0 0 48 16" className="h-4 w-12">
          <text
            x="24"
            y="12.5"
            textAnchor="middle"
            fontFamily="Helvetica, Arial, sans-serif"
            fontSize="14"
            fontWeight="700"
            fontStyle="italic"
            fill="#1A1F71"
          >
            VISA
          </text>
        </svg>
      </li>
      <li className={badgeClass} title="Mastercard">
        <svg role="img" aria-label="Mastercard" viewBox="0 0 38 24" className="h-6 w-9">
          <circle cx="15" cy="12" r="10" fill="#EB001B" />
          <circle cx="23" cy="12" r="10" fill="#F79E1B" />
          <path d="M19 4.47a10 10 0 0 1 0 15.06 10 10 0 0 1 0-15.06Z" fill="#FF5F00" />
        </svg>
      </li>
      <li className={badgeClass} title="Uzcard">
        <svg role="img" aria-label="Uzcard" viewBox="0 0 56 16" className="h-4 w-14">
          <text
            x="28"
            y="12.5"
            textAnchor="middle"
            fontFamily="Helvetica, Arial, sans-serif"
            fontSize="11"
            fontWeight="700"
            fill="#0E4C90"
          >
            UZCARD
          </text>
        </svg>
      </li>
      <li className={badgeClass} title="Humo">
        <svg role="img" aria-label="Humo" viewBox="0 0 48 16" className="h-4 w-12">
          <text
            x="24"
            y="12.5"
            textAnchor="middle"
            fontFamily="Helvetica, Arial, sans-serif"
            fontSize="12"
            fontWeight="700"
            fill="#1296A5"
          >
            HUMO
          </text>
        </svg>
      </li>
    </ul>
  );
}

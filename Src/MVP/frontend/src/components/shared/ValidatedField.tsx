import { type InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../lib/utils';

interface ValidatedFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Field label displayed above the input. */
  label: string;

  /** Error message displayed below the input when validation fails. */
  error?: string;

  /** Additional container class names. */
  containerClassName?: string;
}

/**
 * A labelled input field with inline error display.
 * Wraps a native <input> and renders the error state with a red border and
 * error message. Uses forwardRef so it is compatible with React Hook Form
 * and other ref-based form libraries.
 */
export const ValidatedField = forwardRef<HTMLInputElement, ValidatedFieldProps>(
  ({ label, error, containerClassName, className, id, ...inputProps }, ref) => {
    const field_id = id ?? `field-${label.toLowerCase().replace(/\s+/g, '-')}`;

    return (
      <div className={cn('flex flex-col gap-1', containerClassName)}>
        <label htmlFor={field_id} className="text-sm font-medium text-[#2a2a2a]">
          {label}
        </label>

        <input
          ref={ref}
          id={field_id}
          className={cn(
            'w-full rounded border border-[#cccccc] bg-white px-3 py-2 text-sm text-[#2a2a2a] outline-none transition',
            'placeholder:text-[#484f58] focus:border-[#58a6ff] focus:ring-2 focus:ring-[#58a6ff]/20',
            error && 'border-[#f85149] focus:border-[#f85149] focus:ring-[#f85149]/20',
            className,
          )}
          aria-invalid={!!error}
          aria-describedby={error ? `${field_id}-error` : undefined}
          {...inputProps}
        />

        {error && (
          <span id={`${field_id}-error`} className="text-xs text-[#cc2222]" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  },
);

ValidatedField.displayName = 'ValidatedField';

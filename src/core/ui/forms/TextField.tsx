import type { ComponentProps } from 'react'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/core/ui/field'
import { Input } from '@/core/ui/input'

interface TextFieldProps extends Omit<ComponentProps<typeof Input>, 'id'> {
  id: string
  label: string
  description?: string
  error?: string
  fieldClassName?: string
}

export function TextField({
  id,
  label,
  description,
  error,
  fieldClassName,
  ...props
}: TextFieldProps) {
  const descriptionId = description ? `${id}-description` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy =
    [props['aria-describedby'], descriptionId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <Field className={fieldClassName} data-invalid={Boolean(error)} data-disabled={props.disabled}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        {...props}
        id={id}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={describedBy}
      />
      {description && <FieldDescription id={descriptionId}>{description}</FieldDescription>}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </Field>
  )
}

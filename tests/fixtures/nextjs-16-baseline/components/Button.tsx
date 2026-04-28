import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: 'primary' | 'secondary';
};

export function Button({ children, variant = 'primary', ...rest }: Props) {
  return (
    <button data-variant={variant} {...rest}>
      {children}
    </button>
  );
}

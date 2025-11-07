// app/layout.js
import './globals.css'

export const metadata = {
  title: 'Luminox Stream',
  description: 'Website streaming anime',
}

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  )
}

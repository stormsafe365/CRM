// UnassignedDesigns: a reminder strip on the Leads page while customer designs
// from a design link are not on a lead yet. They are handled on the Customer
// Designs page (sidebar) - the strip opens it on "Not on a lead". Hidden when
// there are none (or before migration 020).

import { useNavigate } from 'react-router-dom'
import { useDesignCounts } from '../lib/useDesignCounts'

export default function UnassignedDesigns() {
  const navigate = useNavigate()
  const { waiting } = useDesignCounts()
  if (!waiting) return null
  return (
    <div className="card" role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', marginBottom: 12, borderColor: 'rgba(34,211,200,.45)' }}>
      <span>
        <b style={{ color: '#22d3c8' }}>{waiting} customer design{waiting === 1 ? '' : 's'}</b> sent from a design link {waiting === 1 ? 'is' : 'are'} not on a lead yet.
      </span>
      <button type="button" className="btn-primary" onClick={() => navigate('/designs?view=waiting')}>Open Customer Designs</button>
    </div>
  )
}

// New Client page. Wraps ClientForm and inserts into Supabase on submit.
// Defaults primary_rep to the current user and first_contact_date to today
// (since most new clients are entered right after the first conversation).

import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import ClientForm from '../components/ClientForm'

export default function ClientNew() {
  const navigate = useNavigate()
  const { user } = useAuth()

  // Today in YYYY-MM-DD format (matches <input type="date">).
  const today = new Date().toISOString().slice(0, 10)

  const initial = {
    primary_rep: user?.id,
    first_contact_date: today,
  }

  async function handleSubmit(payload) {
    const { data, error } = await supabase
      .from('clients')
      .insert(payload)
      .select()
      .single()

    if (error) throw error
    navigate(`/clients/${data.id}`)
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/clients" className="back-link">← Clients</Link>
          <h1>New Client</h1>
        </div>
      </div>
      <ClientForm
        initial={initial}
        onSubmit={handleSubmit}
        onCancel={() => navigate('/clients')}
        submitLabel="Create Client"
      />
    </div>
  )
}

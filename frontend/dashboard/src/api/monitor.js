import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '',
  timeout: 60000,
})

export async function fetchOverview(dimension = 'day', year, startDate, endDate) {
  const params = { dimension }
  if (year) params.year = year
  if (startDate) params.startDate = startDate
  if (endDate) params.endDate = endDate
  const { data: resp } = await api.get('/api/monitor/overview', { params })
  return resp.data || resp
}

export async function fetchWorkshops(dimension = 'day', year, startDate, endDate) {
  const params = { dimension }
  if (year) params.year = year
  if (startDate) params.startDate = startDate
  if (endDate) params.endDate = endDate
  const { data: resp } = await api.get('/api/monitor/workshops', { params })
  return resp.data || resp
}

export async function fetchWorkshopDetail(name, dimension = 'day', year, startDate, endDate) {
  const params = { dimension }
  if (year) params.year = year
  if (startDate) params.startDate = startDate
  if (endDate) params.endDate = endDate
  const { data: resp } = await api.get(`/api/monitor/workshop/${encodeURIComponent(name)}`, { params })
  return resp.data || resp
}

export async function fetchEquipmentDetail(name, dimension = 'day', year, startDate, endDate) {
  const params = { dimension }
  if (year) params.year = year
  if (startDate) params.startDate = startDate
  if (endDate) params.endDate = endDate
  const { data: resp } = await api.get(`/api/monitor/equipment/${encodeURIComponent(name)}`, { params })
  return resp.data || resp
}

export async function fetchEquipmentTypes() {
  const { data: resp } = await api.get('/api/monitor/equipment-types')
  return resp.data || resp
}

export async function triggerSync() {
  const { data: resp } = await api.post('/api/monitor/sync')
  return resp.data || resp
}

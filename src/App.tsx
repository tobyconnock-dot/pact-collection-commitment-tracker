import { useState, useEffect } from 'react'

// Enterprise tier from PDF:
// - 600 boxes OR 11,000 packages OR 75,000 lbs obsolete = 21,000 lbs commitment
// Conversion factors (units per lb of commitment):
// - Boxes: 600/21000 = 0.02857 (PDF shows 0.03)
// - Packages: 11000/21000 = 0.5238
// - Obsolete: 75000/21000 = 3.571

// Tier data from Pact PDF spec (EITHER OR capacities, not cumulative)
const TIERS = {
  Enterprise: { binsCapacity: 600, packagesCapacity: 11000, obsoleteCapacity: 75000, annualCommitment: 21000, fte: '500+ FTE' },
  Corporate: { binsCapacity: 300, packagesCapacity: 5500, obsoleteCapacity: 37500, annualCommitment: 10500, fte: '250-499 FTE' },
  Large: { binsCapacity: 100, packagesCapacity: 1800, obsoleteCapacity: 12500, annualCommitment: 3500, fte: '100-249 FTE' },
  Established: { binsCapacity: 50, packagesCapacity: 900, obsoleteCapacity: 6500, annualCommitment: 1750, fte: '50-99 FTE' },
  Small: { binsCapacity: 5, packagesCapacity: 90, obsoleteCapacity: 650, annualCommitment: 175, fte: '11-49 FTE' },
  Indie: { binsCapacity: 2, packagesCapacity: 40, obsoleteCapacity: 300, annualCommitment: 70, fte: '0-10 FTE' },
}

// Membership cycle: April 1 - March 31 (12 months)
// First cycle launches April 1, 2026 (Question for Pact: confirm launch date)
const CYCLE_END = new Date('2027-03-31')
const TOTAL_CYCLE_MONTHS = 12

type TierName = keyof typeof TIERS
type ProgramType = 'inStore' | 'mailBack' | 'obsolete'

interface HistoricalCycle {
  cycle: string  // e.g., "2023-2024"
  commitment: number
  collected: number
  status: 'exceeded' | 'reached' | 'under'
}

interface MemberData {
  id: string
  memberName: string
  memberTier: TierName
  membershipStartDate: Date
  // Members select 2 or 3 programs to meet commitment (per spec: all 3, or any 2-combo)
  enrolledPrograms: ProgramType[]
  programs: {
    inStore: { processed: number }
    mailBack: { processed: number }
    obsolete: { processed: number }
  }
  historicalCycles?: HistoricalCycle[]  // Past years' performance
}

// Demo data for Pact members
const DEMO_MEMBERS: MemberData[] = [
  {
    id: '1',
    memberName: 'Ulta Beauty',
    memberTier: 'Enterprise',
    membershipStartDate: new Date('2026-04-01'),
    enrolledPrograms: ['inStore', 'obsolete'],  // 2-program combo
    programs: { inStore: { processed: 200 }, mailBack: { processed: 0 }, obsolete: { processed: 10000 } },
  },
  {
    id: '2',
    memberName: 'Credo Beauty',
    memberTier: 'Established',
    membershipStartDate: new Date('2026-04-01'),
    enrolledPrograms: ['inStore', 'mailBack', 'obsolete'],  // All 3 programs
    programs: { inStore: { processed: 15 }, mailBack: { processed: 200 }, obsolete: { processed: 1500 } },
  },
  {
    id: '3',
    memberName: "Kiehl's",
    memberTier: 'Enterprise',
    membershipStartDate: new Date('2026-04-01'),
    enrolledPrograms: ['inStore', 'mailBack'],  // 2-program combo
    programs: { inStore: { processed: 180 }, mailBack: { processed: 2000 }, obsolete: { processed: 0 } },
  },
  {
    id: '4',
    memberName: 'Dr. Loretta',
    memberTier: 'Small',
    membershipStartDate: new Date('2026-04-01'),
    enrolledPrograms: ['mailBack', 'obsolete'],  // 2-program combo
    programs: { inStore: { processed: 0 }, mailBack: { processed: 25 }, obsolete: { processed: 150 } },
  },
  {
    id: '5',
    memberName: 'Saie',
    memberTier: 'Small',
    membershipStartDate: new Date('2026-04-01'),
    enrolledPrograms: ['mailBack', 'obsolete'],  // 2-program combo
    programs: { inStore: { processed: 0 }, mailBack: { processed: 18 }, obsolete: { processed: 100 } },
  },
]

const PROGRAM_LABELS: Record<ProgramType, string> = {
  inStore: 'In-Store Boxes',
  mailBack: 'Mail-Back Packages',
  obsolete: 'Obsolete Inventory',
}

const PROGRAM_SHORT_LABELS: Record<ProgramType, string> = {
  inStore: 'Box',
  mailBack: 'Mail',
  obsolete: 'Obs',
}

// Generate CSV export of member commitment data
function exportMembersToCSV(members: MemberData[]) {
  const headers = [
    'Member Name',
    'Tier',
    'FTE Range',
    'Start Date',
    'Enrolled Programs',
    'Annual Commitment (lbs)',
    'Pro-rated Commitment (lbs)',
    'Months in Cycle',
    'In-Store Boxes (units)',
    'In-Store (lbs)',
    'Mail-Back Packages (units)',
    'Mail-Back (lbs)',
    'Obsolete Inventory (lbs)',
    'Obsolete (lbs contribution)',
    'Total Collected (lbs)',
    'Progress (%)',
    'Status',
  ]

  const rows = members.map(member => {
    const stats = getMemberStats(member)
    const enrolledStr = member.enrolledPrograms.map(p => PROGRAM_LABELS[p]).join('; ')

    return [
      member.memberName,
      member.memberTier,
      stats.tier.fte,
      member.membershipStartDate.toISOString().split('T')[0],
      enrolledStr,
      stats.tier.annualCommitment,
      stats.proratedCommitment,
      stats.monthsInCycle,
      member.programs.inStore.processed,
      stats.inStoreLbs,
      member.programs.mailBack.processed,
      stats.mailBackLbs,
      member.programs.obsolete.processed,
      stats.obsoleteLbs,
      stats.totalLbs,
      Math.round(stats.percentage),
      stats.status.label,
    ]
  })

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
  ].join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `pact-commitment-tracker-${new Date().toISOString().split('T')[0]}.csv`
  link.click()
}

// Calculate pro-rated commitment based on join date
function calculateProratedCommitment(joinDate: Date, fullCommitment: number): { proratedCommitment: number; monthsInCycle: number; prorationPercent: number } {
  const joinMonth = joinDate.getMonth()
  const joinYear = joinDate.getFullYear()
  const cycleEndMonth = CYCLE_END.getMonth()
  const cycleEndYear = CYCLE_END.getFullYear()

  let monthsInCycle = (cycleEndYear - joinYear) * 12 + (cycleEndMonth - joinMonth) + 1
  monthsInCycle = Math.min(monthsInCycle, TOTAL_CYCLE_MONTHS)

  const prorationPercent = monthsInCycle / TOTAL_CYCLE_MONTHS
  const proratedCommitment = Math.round(fullCommitment * prorationPercent)

  return { proratedCommitment, monthsInCycle, prorationPercent }
}

// Calculate lbs contributed from processed units
function calculateLbsContributed(processed: number, capacity: number, annualCommitment: number): number {
  return Math.round((processed / capacity) * annualCommitment)
}

// Status with emojis from PDF - using consistent red/orange/green scheme
function getStatus(percentageComplete: number): { label: string; emoji: string; color: string; bgColor: string; barGradient: string } {
  if (percentageComplete >= 100) {
    return { label: 'Exceeded', emoji: '🎉🎉', color: 'text-green-700', bgColor: 'bg-green-50', barGradient: 'linear-gradient(90deg, #22c55e 0%, #16a34a 100%)' }
  }
  if (percentageComplete >= 90) {
    return { label: 'Reached', emoji: '🎉', color: 'text-green-600', bgColor: 'bg-green-50', barGradient: 'linear-gradient(90deg, #4ade80 0%, #22c55e 100%)' }
  }
  if (percentageComplete >= 70) {
    // On track - green
    return { label: 'On Track', emoji: '👏', color: 'text-green-600', bgColor: 'bg-green-50', barGradient: 'linear-gradient(90deg, #4ade80 0%, #22c55e 100%)' }
  }
  if (percentageComplete >= 50) {
    // Needs attention - orange
    return { label: 'Needs Attention', emoji: '', color: 'text-orange-600', bgColor: 'bg-orange-50', barGradient: 'linear-gradient(90deg, #fb923c 0%, #f97316 100%)' }
  }
  // At risk - red
  return { label: 'At Risk', emoji: '', color: 'text-red-600', bgColor: 'bg-red-50', barGradient: 'linear-gradient(90deg, #f87171 0%, #ef4444 100%)' }
}

// Get member stats - only counts enrolled programs (members pick 2 or 3 programs per spec)
function getMemberStats(member: MemberData) {
  const tier = TIERS[member.memberTier]
  const { proratedCommitment, monthsInCycle, prorationPercent } = calculateProratedCommitment(
    member.membershipStartDate,
    tier.annualCommitment
  )

  // Calculate lbs only from enrolled programs
  const inStoreLbs = member.enrolledPrograms.includes('inStore')
    ? calculateLbsContributed(member.programs.inStore.processed, tier.binsCapacity, tier.annualCommitment)
    : 0
  const mailBackLbs = member.enrolledPrograms.includes('mailBack')
    ? calculateLbsContributed(member.programs.mailBack.processed, tier.packagesCapacity, tier.annualCommitment)
    : 0
  const obsoleteLbs = member.enrolledPrograms.includes('obsolete')
    ? calculateLbsContributed(member.programs.obsolete.processed, tier.obsoleteCapacity, tier.annualCommitment)
    : 0

  const totalLbs = inStoreLbs + mailBackLbs + obsoleteLbs
  const percentage = proratedCommitment > 0 ? (totalLbs / proratedCommitment) * 100 : 0
  const status = getStatus(percentage)

  return {
    tier,
    proratedCommitment,
    monthsInCycle,
    prorationPercent,
    inStoreLbs,
    mailBackLbs,
    obsoleteLbs,
    totalLbs,
    percentage,
    status,
    enrolledPrograms: member.enrolledPrograms,
  }
}

// Header component - matches Pact dashboard style
function Header({ viewMode, setViewMode }: { viewMode: 'member' | 'admin'; setViewMode: (v: 'member' | 'admin') => void }) {
  return (
    <header className="bg-[#F9FAFA] border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-6">
        {/* Top row - logo and account controls */}
        <div className="flex items-center justify-between h-16">
<img src="/pact-logo.png" alt="Pact - Powered by Pentatonic" className="h-10" />
          <div className="flex items-center gap-3 text-sm">
            <button className="p-2 text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
            </button>
            {/* Consolidated account menu */}
            <button className="flex items-center gap-2 px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50">
              <span className="w-2 h-2 rounded-full bg-[#49868C]"></span>
              <span className="text-gray-600">{viewMode === 'admin' ? 'admin@pact.com' : 'member@pact.com'}</span>
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
          </div>
        </div>
        {/* Navigation row */}
        <nav className="flex items-center justify-between">
          <div className="flex gap-1">
            {['Dashboard', 'Operations', 'Members & Stores', 'Analytics', 'Administration'].map((tab) => (
              <button
                key={tab}
                className={`flex items-center gap-1 px-4 py-3 text-sm whitespace-nowrap ${
                  tab === 'Analytics'
                    ? 'text-[#49868C] font-medium'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab}
                {tab !== 'Dashboard' && (
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                )}
              </button>
            ))}
          </div>
          {/* View Toggle - icon-based for space saving */}
          <div className="flex border border-gray-200 rounded overflow-hidden">
            <button
              onClick={() => setViewMode('member')}
              className={`p-2 ${viewMode === 'member' ? 'bg-[#49868C] text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
              title="Member Portal"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            </button>
            <button
              onClick={() => setViewMode('admin')}
              className={`p-2 ${viewMode === 'admin' ? 'bg-[#49868C] text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
              title="Admin View"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </button>
          </div>
        </nav>
      </div>
    </header>
  )
}

// Member Portal View - shows single member's dashboard
function MemberPortalView({ member }: { member: MemberData }) {
  const stats = getMemberStats(member)
  const { tier, proratedCommitment, monthsInCycle, totalLbs } = stats

  const remainingLbs = Math.max(0, proratedCommitment - totalLbs)

  // Interactive calculator state for "Remaining to Reach Commitment"
  const [calculatorValues, setCalculatorValues] = useState<Record<ProgramType, number>>({
    inStore: 0,
    mailBack: 0,
    obsolete: 0,
  })

  // Track which sliders were touched (for 3-program logic)
  const [touchedSliders, setTouchedSliders] = useState<ProgramType[]>([])

  return (
    <main className="max-w-6xl mx-auto px-6 py-8">
      {/* Page Title - simplified, member knows who they are */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-gray-900">
          Collection Commitment Tracker
        </h1>
        <p className="text-gray-400 text-sm mt-1">Cycle: Apr 2026 - Mar 2027</p>
      </div>

      {/* Pro-ration Notice - only if applicable */}
      {monthsInCycle < TOTAL_CYCLE_MONTHS && (
        <div className="bg-amber-50 border border-amber-200 rounded px-4 py-3 mb-6">
          <p className="text-sm text-amber-800">
            <span className="font-medium">Pro-rated:</span> Joined mid-cycle. Commitment adjusted to {proratedCommitment.toLocaleString()} lbs ({monthsInCycle}/12 months).
          </p>
        </div>
      )}

      {/* Program Activity - shows what's been processed in each program */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6">
        <h2 className="text-gray-700 font-medium mb-4">Programs Processed</h2>
        <p className="text-gray-500 text-sm mb-4">
          You can meet your commitment through any combination of your enrolled programs.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          {member.enrolledPrograms.includes('inStore') && (
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="text-xs text-gray-400 uppercase mb-1">In-Store Boxes</div>
              <div className="text-2xl font-semibold text-gray-800">
                {member.programs.inStore.processed.toLocaleString()}
                <span className="text-lg font-normal text-gray-400"> / {tier.binsCapacity.toLocaleString()}</span>
              </div>
              <div className="text-sm text-gray-500">boxes processed</div>
            </div>
          )}
          {member.enrolledPrograms.includes('mailBack') && (
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="text-xs text-gray-400 uppercase mb-1">Mail-Back Packages</div>
              <div className="text-2xl font-semibold text-gray-800">
                {member.programs.mailBack.processed.toLocaleString()}
                <span className="text-lg font-normal text-gray-400"> / {tier.packagesCapacity.toLocaleString()}</span>
              </div>
              <div className="text-sm text-gray-500">packages processed</div>
            </div>
          )}
          {member.enrolledPrograms.includes('obsolete') && (
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="text-xs text-gray-400 uppercase mb-1">Obsolete Inventory</div>
              <div className="text-2xl font-semibold text-gray-800">
                {member.programs.obsolete.processed.toLocaleString()}
                <span className="text-lg font-normal text-gray-400"> / {tier.obsoleteCapacity.toLocaleString()}</span>
              </div>
              <div className="text-sm text-gray-500">lbs processed</div>
            </div>
          )}
        </div>
      </div>

      {/* Remaining - Interactive calculator to explore combinations */}
      {remainingLbs > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6">
          <h2 className="text-gray-700 font-medium mb-4">Remaining to Reach Commitment</h2>
          <p className="text-gray-500 text-sm mb-4">
            {member.enrolledPrograms.length === 2
              ? 'Adjust either slider - the other will update to complete the commitment:'
              : 'Set any 2 sliders - the 3rd will automatically adjust to complete the commitment:'}
          </p>

          {(() => {
            // Calculate total lbs from calculator values
            const calculatorLbs = member.enrolledPrograms.reduce((sum, program) => {
              const units = calculatorValues[program]
              if (program === 'inStore') {
                return sum + Math.round((units / tier.binsCapacity) * tier.annualCommitment)
              } else if (program === 'mailBack') {
                return sum + Math.round((units / tier.packagesCapacity) * tier.annualCommitment)
              } else if (program === 'obsolete') {
                return sum + Math.round((units / tier.obsoleteCapacity) * tier.annualCommitment)
              }
              return sum
            }, 0)

            const stillRemaining = Math.max(0, remainingLbs - calculatorLbs)

            // Handler that adjusts other sliders when one changes
            const handleSliderChange = (changedProgram: ProgramType, newValue: number) => {
              // Update touched sliders list (keep last 2 for 3-program members)
              const newTouched = [changedProgram, ...touchedSliders.filter(p => p !== changedProgram)].slice(0, 2)
              setTouchedSliders(newTouched)

              // Calculate lbs contribution from the changed slider
              let changedLbs = 0
              if (changedProgram === 'inStore') {
                changedLbs = Math.round((newValue / tier.binsCapacity) * tier.annualCommitment)
              } else if (changedProgram === 'mailBack') {
                changedLbs = Math.round((newValue / tier.packagesCapacity) * tier.annualCommitment)
              } else if (changedProgram === 'obsolete') {
                changedLbs = Math.round((newValue / tier.obsoleteCapacity) * tier.annualCommitment)
              }

              const newValues: Record<ProgramType, number> = { ...calculatorValues, [changedProgram]: newValue }

              // Get other enrolled programs
              const otherPrograms = member.enrolledPrograms.filter(p => p !== changedProgram)

              if (otherPrograms.length === 1) {
                // 2-program member: adjust the other program to complete commitment
                const stillNeeded = Math.max(0, remainingLbs - changedLbs)
                const otherProgram = otherPrograms[0]
                if (otherProgram === 'inStore') {
                  newValues.inStore = Math.round((stillNeeded / tier.annualCommitment) * tier.binsCapacity)
                } else if (otherProgram === 'mailBack') {
                  newValues.mailBack = Math.round((stillNeeded / tier.annualCommitment) * tier.packagesCapacity)
                } else if (otherProgram === 'obsolete') {
                  newValues.obsolete = Math.round((stillNeeded / tier.annualCommitment) * tier.obsoleteCapacity)
                }
              } else if (otherPrograms.length === 2) {
                // 3-program member: user sets 2 sliders, 3rd auto-adjusts
                // If user has touched 2+ sliders, calculate the 3rd one
                if (newTouched.length >= 2) {
                  // Calculate lbs from the 2 touched sliders
                  let touchedLbs = 0
                  newTouched.forEach(prog => {
                    const val = prog === changedProgram ? newValue : calculatorValues[prog]
                    if (prog === 'inStore') {
                      touchedLbs += Math.round((val / tier.binsCapacity) * tier.annualCommitment)
                    } else if (prog === 'mailBack') {
                      touchedLbs += Math.round((val / tier.packagesCapacity) * tier.annualCommitment)
                    } else if (prog === 'obsolete') {
                      touchedLbs += Math.round((val / tier.obsoleteCapacity) * tier.annualCommitment)
                    }
                  })

                  // The untouched program fills the gap
                  const untouchedProgram = member.enrolledPrograms.find(p => !newTouched.includes(p))
                  const stillNeeded = Math.max(0, remainingLbs - touchedLbs)

                  if (untouchedProgram === 'inStore') {
                    newValues.inStore = Math.round((stillNeeded / tier.annualCommitment) * tier.binsCapacity)
                  } else if (untouchedProgram === 'mailBack') {
                    newValues.mailBack = Math.round((stillNeeded / tier.annualCommitment) * tier.packagesCapacity)
                  } else if (untouchedProgram === 'obsolete') {
                    newValues.obsolete = Math.round((stillNeeded / tier.annualCommitment) * tier.obsoleteCapacity)
                  }
                }
                // If only 1 slider touched so far, just update that one value (others stay at current)
              }

              setCalculatorValues(newValues)
            }

            return (
              <>
                <div className="space-y-4">
                  {member.enrolledPrograms.includes('inStore') && (
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-700">In-Store Boxes</span>
                        <span className="text-sm font-semibold text-[#49868C]">
                          {calculatorValues.inStore.toLocaleString()} boxes
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max={Math.ceil((remainingLbs / tier.annualCommitment) * tier.binsCapacity)}
                        value={calculatorValues.inStore}
                        onChange={(e) => handleSliderChange('inStore', parseInt(e.target.value))}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#49868C]"
                      />
                    </div>
                  )}

                  {member.enrolledPrograms.includes('mailBack') && (
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-700">Mail-Back Packages</span>
                        <span className="text-sm font-semibold text-[#49868C]">
                          {calculatorValues.mailBack.toLocaleString()} packages
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max={Math.ceil((remainingLbs / tier.annualCommitment) * tier.packagesCapacity)}
                        value={calculatorValues.mailBack}
                        onChange={(e) => handleSliderChange('mailBack', parseInt(e.target.value))}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#49868C]"
                      />
                    </div>
                  )}

                  {member.enrolledPrograms.includes('obsolete') && (
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-700">Obsolete Inventory</span>
                        <span className="text-sm font-semibold text-[#49868C]">
                          {calculatorValues.obsolete.toLocaleString()} lbs
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max={Math.ceil((remainingLbs / tier.annualCommitment) * tier.obsoleteCapacity)}
                        value={calculatorValues.obsolete}
                        onChange={(e) => handleSliderChange('obsolete', parseInt(e.target.value))}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#49868C]"
                      />
                    </div>
                  )}
                </div>

                {/* Summary */}
                <div className={`mt-4 p-4 rounded-lg border ${stillRemaining === 0 ? 'bg-green-50 border-green-200' : 'bg-[#49868C]/5 border-[#49868C]/20'}`}>
                  <p className={`text-sm font-semibold text-center ${stillRemaining === 0 ? 'text-green-600' : 'text-gray-600'}`}>
                    {stillRemaining === 0 ? 'Commitment reached! ✓' : 'Adjust sliders to find a combination that meets your commitment'}
                  </p>
                </div>

                <button
                  onClick={() => {
                    setCalculatorValues({ inStore: 0, mailBack: 0, obsolete: 0 })
                    setTouchedSliders([])
                  }}
                  className="mt-3 text-xs text-gray-500 hover:text-gray-700 underline"
                >
                  Reset calculator
                </button>
              </>
            )
          })()}
        </div>
      )}

      {/* Historical Cycles */}
      {member.historicalCycles && member.historicalCycles.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="text-gray-700 font-medium mb-4">Previous Cycles</h2>
          <div className="space-y-2">
            {member.historicalCycles.map((cycle) => (
              <div key={cycle.cycle} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-4">
                  <span className="font-medium text-gray-700">{cycle.cycle}</span>
                  <span className="text-sm text-gray-500">
                    {cycle.collected.toLocaleString()} / {cycle.commitment.toLocaleString()} lbs
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-24 bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${
                        cycle.status === 'exceeded' ? 'bg-green-500' :
                        cycle.status === 'reached' ? 'bg-green-400' : 'bg-gray-400'
                      }`}
                      style={{ width: `${Math.min((cycle.collected / cycle.commitment) * 100, 100)}%` }}
                    />
                  </div>
                  <span className="text-sm text-gray-600 w-16">
                    {Math.round((cycle.collected / cycle.commitment) * 100)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  )
}

// Admin View - shows all members with management options
type FilterType = 'all' | 'onTrack' | 'attention' | 'atRisk'

// Valid 2-program combos per Pact spec
const VALID_PROGRAM_COMBOS: ProgramType[][] = [
  ['inStore', 'mailBack', 'obsolete'],  // All 3
  ['inStore', 'mailBack'],              // 2-combo
  ['inStore', 'obsolete'],              // 2-combo
  ['mailBack', 'obsolete'],             // 2-combo
]

function AdminView({
  members,
  onUpdateMember,
  selectedMember,
  setSelectedMember,
}: {
  members: MemberData[]
  onUpdateMember: (id: string, updates: Partial<MemberData>) => void
  selectedMember: MemberData | null
  setSelectedMember: (m: MemberData | null) => void
}) {
  const [editingTier, setEditingTier] = useState<string | null>(null)
  const [newTier, setNewTier] = useState<TierName>('Enterprise')
  const [filter, setFilter] = useState<FilterType>('all')
  const [editingPrograms, setEditingPrograms] = useState<string | null>(null)
  const [selectedPrograms, setSelectedPrograms] = useState<ProgramType[]>([])

  // Tier change confirmation
  const [confirmTierChange, setConfirmTierChange] = useState<{memberId: string, newTier: TierName, oldTier: TierName} | null>(null)

  const handleTierSave = (memberId: string) => {
    const member = members.find(m => m.id === memberId)
    if (member && newTier !== member.memberTier) {
      setConfirmTierChange({ memberId, newTier, oldTier: member.memberTier })
    }
    setEditingTier(null)
  }

  const confirmTierUpdate = () => {
    if (confirmTierChange) {
      onUpdateMember(confirmTierChange.memberId, { memberTier: confirmTierChange.newTier })
      setConfirmTierChange(null)
    }
  }

  // Program editing
  const handleProgramEdit = (memberId: string, currentPrograms: ProgramType[]) => {
    setEditingPrograms(memberId)
    setSelectedPrograms([...currentPrograms])
  }

  const toggleProgram = (program: ProgramType) => {
    setSelectedPrograms(prev => {
      if (prev.includes(program)) {
        // Can't go below 2 programs
        if (prev.length <= 2) return prev
        return prev.filter(p => p !== program)
      } else {
        return [...prev, program]
      }
    })
  }

  const handleProgramSave = (memberId: string) => {
    // Validate it's a valid combo
    const isValid = VALID_PROGRAM_COMBOS.some(combo =>
      combo.length === selectedPrograms.length &&
      combo.every(p => selectedPrograms.includes(p))
    )
    if (isValid) {
      onUpdateMember(memberId, { enrolledPrograms: selectedPrograms })
    }
    setEditingPrograms(null)
  }

  // Filter members based on selected filter (aligned with status thresholds)
  const filteredMembers = members.filter(member => {
    const stats = getMemberStats(member)
    switch (filter) {
      case 'onTrack': return stats.percentage >= 70  // Green
      case 'attention': return stats.percentage >= 50 && stats.percentage < 70  // Orange
      case 'atRisk': return stats.percentage < 50  // Red
      default: return true
    }
  })

  // Counts for filter buttons
  const onTrackCount = members.filter(m => getMemberStats(m).percentage >= 70).length
  const attentionCount = members.filter(m => { const p = getMemberStats(m).percentage; return p >= 50 && p < 70 }).length
  const atRiskCount = members.filter(m => getMemberStats(m).percentage < 50).length

  return (
    <main className="max-w-6xl mx-auto px-6 py-8">
      {/* Page Title */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-gray-900">
          Collection Commitment Tracker
        </h1>
        <p className="text-gray-400 text-sm mt-1">Admin View</p>
      </div>

      <div className="flex items-center justify-between mb-6">
        {/* Quick Filters */}
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === 'all' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All ({members.length})
          </button>
          <button
            onClick={() => setFilter('onTrack')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === 'onTrack' ? 'bg-green-600 text-white' : 'bg-green-50 text-green-700 hover:bg-green-100'
            }`}
          >
            On Track ({onTrackCount})
          </button>
          <button
            onClick={() => setFilter('attention')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === 'attention' ? 'bg-orange-500 text-white' : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
            }`}
          >
            Needs Attention ({attentionCount})
          </button>
          <button
            onClick={() => setFilter('atRisk')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === 'atRisk' ? 'bg-red-500 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100'
            }`}
          >
            At Risk ({atRiskCount})
          </button>
        </div>

        <button
          onClick={() => exportMembersToCSV(members)}
          className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
        >
          Export CSV
        </button>
      </div>

      {/* Members Table - Simplified: removed Status column (redundant with progress bar) */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden mb-6">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr className="text-left text-sm text-gray-500">
              <th className="px-4 py-3 font-medium">Member</th>
              <th className="px-4 py-3 font-medium">Tier</th>
              <th className="px-4 py-3 font-medium">Activity</th>
              <th className="px-4 py-3 font-medium text-right">Commitment</th>
              <th className="px-4 py-3 font-medium text-right">Collected</th>
              <th className="px-4 py-3 font-medium text-right">Progress</th>
            </tr>
          </thead>
          <tbody>
            {filteredMembers.map((member) => {
              const stats = getMemberStats(member)

              return (
                <tr key={member.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setSelectedMember(member)}
                      className="text-[#49868C] hover:underline font-medium text-left"
                    >
                      {member.memberName}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {editingTier === member.id ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={newTier}
                          onChange={(e) => setNewTier(e.target.value as TierName)}
                          className="border rounded px-2 py-1 text-sm"
                        >
                          {(Object.keys(TIERS) as TierName[]).map(tierName => (
                            <option key={tierName} value={tierName}>{tierName}</option>
                          ))}
                        </select>
                        <button onClick={() => handleTierSave(member.id)} className="text-green-600 text-xs font-medium">Save</button>
                        <button onClick={() => setEditingTier(null)} className="text-gray-400 text-xs">Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingTier(member.id); setNewTier(member.memberTier) }}
                        className="text-gray-600 hover:text-[#49868C]"
                      >
                        {member.memberTier}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {editingPrograms === member.id ? (
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          {(['inStore', 'mailBack', 'obsolete'] as ProgramType[]).map(prog => (
                            <button
                              key={prog}
                              onClick={() => toggleProgram(prog)}
                              className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
                                selectedPrograms.includes(prog)
                                  ? 'bg-[#49868C] text-white border-[#49868C]'
                                  : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
                              }`}
                            >
                              {PROGRAM_SHORT_LABELS[prog]}
                            </button>
                          ))}
                        </div>
                        <button onClick={() => handleProgramSave(member.id)} className="text-green-600 text-xs font-medium">Save</button>
                        <button onClick={() => setEditingPrograms(null)} className="text-gray-400 text-xs">Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleProgramEdit(member.id, member.enrolledPrograms)}
                        className="flex gap-1 group"
                        title="Edit enrolled programs"
                      >
                        {member.enrolledPrograms.map(prog => (
                          <span key={prog} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-[10px] rounded group-hover:bg-[#49868C]/10 group-hover:text-[#49868C]">
                            {PROGRAM_SHORT_LABELS[prog]}
                          </span>
                        ))}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-gray-600">
                    {stats.proratedCommitment.toLocaleString()} lbs
                    {stats.monthsInCycle < 12 && <span className="text-xs text-gray-400 ml-1">({stats.monthsInCycle}mo)</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-right font-medium">{stats.totalLbs.toLocaleString()} lbs</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-24 bg-gray-100 rounded-full h-2">
                        <div
                          className="h-2 rounded-full"
                          style={{ width: `${Math.min(stats.percentage, 100)}%`, background: stats.status.barGradient }}
                        />
                      </div>
                      <span className="text-sm font-medium text-gray-700 w-12 text-right">{Math.round(stats.percentage)}%</span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Tier Reference */}
      <div className="bg-white border border-gray-100 rounded-xl p-6">
        <h3 className="text-gray-700 font-medium mb-4">Tier Reference</h3>
        <div className="grid grid-cols-6 gap-3 text-sm">
          {(Object.keys(TIERS) as TierName[]).map(tierName => (
            <div key={tierName} className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="font-medium text-gray-700">{tierName}</div>
              <div className="text-xs text-gray-400">{TIERS[tierName].fte}</div>
              <div className="text-gray-700 font-semibold mt-1">{TIERS[tierName].annualCommitment.toLocaleString()} lbs</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tier Change Confirmation Modal */}
      {confirmTierChange && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm">
            <h2 className="text-gray-700 font-medium mb-2">Confirm Tier Change</h2>
            <p className="text-sm text-gray-500 mb-4">
              Change tier from <span className="font-medium">{confirmTierChange.oldTier}</span> to <span className="font-medium">{confirmTierChange.newTier}</span>?
              This will update the member's commitment.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmTierChange(null)} className="px-4 py-2 text-gray-500 text-sm">Cancel</button>
              <button onClick={confirmTierUpdate} className="px-4 py-2 bg-[#49868C] text-white rounded-lg text-sm font-medium">Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* Member Detail - Slide-over panel instead of modal */}
      {selectedMember && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSelectedMember(null)} />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-4xl bg-white shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <h2 className="text-gray-700 font-medium">{selectedMember.memberName}</h2>
              <button onClick={() => setSelectedMember(null)} className="text-gray-400 hover:text-gray-600 p-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-6">
              <MemberPortalView member={selectedMember} />
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function App() {
  // Persist view mode in localStorage
  const [viewMode, setViewMode] = useState<'member' | 'admin'>(() => {
    const saved = localStorage.getItem('pact-view-mode')
    return (saved === 'admin' || saved === 'member') ? saved : 'member'
  })
  const [members, setMembers] = useState<MemberData[]>(DEMO_MEMBERS)
  const [selectedMember, setSelectedMember] = useState<MemberData | null>(null)

  // Save view mode to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('pact-view-mode', viewMode)
  }, [viewMode])

  // For the member portal, show the first member
  const currentMember = members[0]

  const handleUpdateMember = (id: string, updates: Partial<MemberData>) => {
    setMembers(prev => prev.map(m => {
      if (m.id === id) {
        return { ...m, ...updates }
      }
      return m
    }))

    // Also update selectedMember if it's the one being edited
    if (selectedMember?.id === id) {
      setSelectedMember(prev => prev ? { ...prev, ...updates } : null)
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <Header viewMode={viewMode} setViewMode={setViewMode} />

      {viewMode === 'member' ? (
        <MemberPortalView member={currentMember} />
      ) : (
        <AdminView
          members={members}
          onUpdateMember={handleUpdateMember}
          selectedMember={selectedMember}
          setSelectedMember={setSelectedMember}
        />
      )}
    </div>
  )
}

export default App

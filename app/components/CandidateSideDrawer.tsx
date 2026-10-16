'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  X,
  Bookmark,
  Briefcase,
  FileText,
  User,
  Sparkles,
  ExternalLink,
  Trash2,
  Edit3,
  Plus,
  CheckCircle2,
  Clock,
  Building2,
  Share2,
  HelpCircle,
  LogOut,
  SlidersHorizontal,
  Upload,
  Download,
  ShieldCheck,
  AlertTriangle,
  Phone,
  Zap,
} from './icons';
import { ICON_STROKE_WIDTH, ICON_SIZES } from '../lib/iconRules';
import UserTierBadge from './UserTierBadge';

export interface CandidateApplication {
  id: string;
  company: string;
  role: string;
  location: string;
  appliedDate: string;
  status: 'Applied' | 'Under Review' | 'Shortlisted' | 'Interview Scheduled' | 'Offer Received' | 'Archived';
  portalUrl?: string;
  notes?: string;
}

interface CandidateSideDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  user: any;
  accessStatus: any;
  candidateProfile?: any;
  savedJobIds: string[];
  savedJobsDetails: any[];
  onToggleSaveJob: (jobId: string) => void;
  onOpenResumeBuilder: () => void;
  onOpenCareerGuidance: () => void;
  onOpenEditProfile: () => void;
  onOpenTour: () => void;
  onSignOut: () => void;
}

export default function CandidateSideDrawer({
  isOpen,
  onClose,
  user,
  accessStatus,
  candidateProfile: propProfile,
  savedJobIds,
  savedJobsDetails,
  onToggleSaveJob,
  onOpenResumeBuilder,
  onOpenCareerGuidance,
  onOpenEditProfile,
  onOpenTour,
  onSignOut,
}: CandidateSideDrawerProps) {
  const [activeTab, setActiveTab] = useState<'saved' | 'applications' | 'resume' | 'perks'>('saved');
  const [applications, setApplications] = useState<CandidateApplication[]>([]);
  const [filterAppStatus, setFilterAppStatus] = useState<string>('all');
  const [candidateProfile, setCandidateProfile] = useState<any>(propProfile || null);

  // Quick New Application Form Modal State
  const [isAddingApp, setIsAddingApp] = useState(false);
  const [newCompany, setNewCompany] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newStatus, setNewStatus] = useState<CandidateApplication['status']>('Applied');
  const [newPortalUrl, setNewPortalUrl] = useState('');

  // Uploaded Resume State
  const [uploadedResume, setUploadedResume] = useState<{
    fileName: string;
    fileSize: string;
    uploadedAt: string;
    rawText?: string;
  } | null>(null);
  const [isUploadingInDrawer, setIsUploadingInDrawer] = useState(false);
  const [drawerUploadNotice, setDrawerUploadNotice] = useState<string | null>(null);

  // Load applications, profile, and resume specific to this user ID
  useEffect(() => {
    if (propProfile) {
      setCandidateProfile(propProfile);
    }
  }, [propProfile]);

  useEffect(() => {
    if (!user?.id) return;

    try {
      const appKey = `nichehire_applications_${user.id}`;
      const savedApps = localStorage.getItem(appKey);
      if (savedApps) {
        setApplications(JSON.parse(savedApps));
      } else {
        setApplications([]);
      }

      if (!propProfile) {
        const profKey = `nichehire_candidate_profile_${user.id}`;
        const profData = localStorage.getItem(profKey);
        if (profData) {
          setCandidateProfile(JSON.parse(profData));
        }
      }

      const resumeKey = `nichehire_uploaded_resume_${user.id}`;
      const savedResume = localStorage.getItem(resumeKey);
      if (savedResume) {
        setUploadedResume(JSON.parse(savedResume));
      }
    } catch {
      // Ignore
    }
  }, [user?.id, isOpen, propProfile]);

  const handleDrawerResumeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;

    setIsUploadingInDrawer(true);
    setDrawerUploadNotice(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64String = (reader.result as string).split(',')[1];
          const res = await fetch('/api/resume/parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileBase64: base64String,
              mimeType: file.type || 'application/pdf',
              fileName: file.name,
            }),
          });

          const data = await res.json();
          if (data) {
            const resumeMeta = {
              fileName: file.name,
              fileSize: `${Math.round(file.size / 1024)} KB`,
              uploadedAt: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
              rawText: data.rawText || '',
            };
            setUploadedResume(resumeMeta);
            localStorage.setItem(`nichehire_uploaded_resume_${user.id}`, JSON.stringify(resumeMeta));

            // Also update candidate profile if empty
            const profKey = `nichehire_candidate_profile_${user.id}`;
            const existingProf = JSON.parse(localStorage.getItem(profKey) || '{}');
            const updatedProf = {
              ...existingProf,
              fullName: existingProf.fullName || (data.name && data.name !== 'Applicant' ? data.name : ''),
              headline: existingProf.headline || data.role || '',
              city: existingProf.city || data.location || '',
              degree: existingProf.degree || data.education || '',
              skills: Array.isArray(data.skills) && data.skills.length > 0
                ? Array.from(new Set([...(existingProf.skills || []), ...data.skills]))
                : (existingProf.skills || []),
              bio: existingProf.bio || data.summary || '',
            };
            setCandidateProfile(updatedProf);
            localStorage.setItem(profKey, JSON.stringify(updatedProf));

            setDrawerUploadNotice(`✓ Resume "${file.name}" uploaded & profile synced!`);
            setTimeout(() => setDrawerUploadNotice(null), 4000);
          }
        } catch {
          setDrawerUploadNotice('Could not parse resume file. Please try another PDF or DOCX.');
        } finally {
          setIsUploadingInDrawer(false);
        }
      };
      reader.readAsDataURL(file);
    } catch {
      setIsUploadingInDrawer(false);
      setDrawerUploadNotice('Failed to read file.');
    }
  };

  if (!isOpen) return null;

  const saveApplicationsToStorage = (updated: CandidateApplication[]) => {
    setApplications(updated);
    if (!user?.id) return;
    try {
      localStorage.setItem(`nichehire_applications_${user.id}`, JSON.stringify(updated));
    } catch {
      // Ignore
    }
  };

  const handleAddApplication = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompany.trim() || !newRole.trim()) return;

    const newApp: CandidateApplication = {
      id: `app-${Date.now()}`,
      company: newCompany.trim(),
      role: newRole.trim(),
      location: newLocation.trim() || 'Pan-India',
      appliedDate: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
      status: newStatus,
      portalUrl: newPortalUrl.trim() || undefined,
    };

    const updated = [newApp, ...applications];
    saveApplicationsToStorage(updated);
    setNewCompany('');
    setNewRole('');
    setNewLocation('');
    setNewPortalUrl('');
    setIsAddingApp(false);
  };

  const handleUpdateStatus = (appId: string, status: CandidateApplication['status']) => {
    const updated = applications.map((a) => (a.id === appId ? { ...a, status } : a));
    saveApplicationsToStorage(updated);
  };

  const handleDeleteApplication = (appId: string) => {
    const updated = applications.filter((a) => a.id !== appId);
    saveApplicationsToStorage(updated);
  };

  const filteredApplications = applications.filter((app) => {
    if (filterAppStatus === 'all') return true;
    if (filterAppStatus === 'pending') return app.status === 'Applied' || app.status === 'Under Review';
    if (filterAppStatus === 'interview') return app.status === 'Shortlisted' || app.status === 'Interview Scheduled';
    return app.status.toLowerCase() === filterAppStatus.toLowerCase();
  });

  // Calculate profile completeness score
  const calculateCompleteness = () => {
    let score = 30; // base account
    if (candidateProfile?.fullName) score += 15;
    if (candidateProfile?.headline) score += 15;
    if (candidateProfile?.degree) score += 15;
    if (candidateProfile?.skills?.length > 0) score += 15;
    if (candidateProfile?.bio) score += 10;
    return Math.min(score, 100);
  };

  const completeness = calculateCompleteness();
  const displayName = candidateProfile?.fullName || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Candidate';

  // Calculate days left in active 30-day candidate allotment cycle
  const getCandidateCycleDaysLeft = () => {
    if (accessStatus?.subscriptionRenewsAt) {
      try {
        const renews = new Date(accessStatus.subscriptionRenewsAt).getTime();
        return Math.max(0, Math.ceil((renews - Date.now()) / (1000 * 60 * 60 * 24)));
      } catch {}
    }
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
    return Math.max(1, Math.ceil((nextMonth - Date.now()) / (1000 * 60 * 60 * 24)));
  };

  const candidateDaysLeft = getCandidateCycleDaysLeft();

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-xs transition-opacity duration-300"
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-white shadow-2xl flex flex-col justify-between border-l border-[#E4E7EC] animate-in slide-in-from-right duration-200">
          {/* ── Top Header of Drawer ── */}
          <div className="p-5 border-b border-[#E4E7EC] bg-[#F7F8FA]">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-[#12172B] text-white flex items-center justify-center font-bold text-xs uppercase">
                  {displayName.slice(0, 2)}
                </span>
                <div>
                  <h3 className="text-sm font-bold text-[#12172B] leading-none">
                    Hi, {displayName}
                  </h3>
                  <span className="text-[11px] text-[#5B6478] truncate max-w-[180px] block">
                    {user?.email}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <UserTierBadge access={accessStatus} compact={true} />
                <button
                  onClick={onClose}
                  className="p-1 text-[#5B6478] hover:text-[#12172B] rounded-lg hover:bg-white transition-colors"
                >
                  <X size={ICON_SIZES.action} strokeWidth={ICON_STROKE_WIDTH} />
                </button>
              </div>
            </div>

            {/* Profile Progress & Edit Trigger */}
            <div className="bg-white p-3 rounded-xl border border-[#E4E7EC] shadow-2xs space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#5B6478] font-medium">Profile Strength</span>
                <span className="font-bold text-[#2B4EE6]">{completeness}%</span>
              </div>
              <div className="w-full bg-[#E4E7EC] h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-[#2B4EE6] h-full rounded-full transition-all duration-500"
                  style={{ width: `${completeness}%` }}
                />
              </div>
              <div className="flex items-center justify-between pt-1 text-[11px]">
                <span className="text-[#5B6478]">
                  {candidateProfile?.headline || 'Add education, skills & CTC'}
                </span>
                <button
                  onClick={() => {
                    onClose();
                    onOpenEditProfile();
                  }}
                  className="font-semibold text-[#2B4EE6] hover:underline inline-flex items-center gap-1"
                >
                  <Edit3 size={11} strokeWidth={ICON_STROKE_WIDTH} />
                  <span>Edit Profile</span>
                </button>
              </div>
            </div>

            {/* Candidate Membership & Quota Expiry Alert Card */}
            <div className="mt-3 p-3 rounded-xl border border-indigo-100 bg-gradient-to-r from-blue-50/70 via-indigo-50/50 to-white text-xs space-y-2 shadow-2xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-bold text-gray-900">
                  <Clock size={13} strokeWidth={ICON_STROKE_WIDTH} className="text-[#2B4EE6]" />
                  <span>Membership Cycle Status</span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                  ⏱️ {candidateDaysLeft} {candidateDaysLeft === 1 ? 'day' : 'days'} left
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px] text-gray-600 pt-0.5 border-t border-indigo-100/70">
                <span>Monthly AI Resume Tailoring:</span>
                <span className="font-semibold text-gray-900">
                  {accessStatus?.quotaBypass ? 'Unlimited' : `${accessStatus?.remainingQuotas?.tailoredResumes ?? 5} / 11 left`}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-gray-600">
                <span>HR Direct Outreach:</span>
                <span className="font-semibold text-gray-900">
                  {accessStatus?.quotaBypass ? 'Unlimited' : `${accessStatus?.remainingQuotas?.hrEmailDrafts ?? 5} / 20 left`}
                </span>
              </div>

              {/* Mobile OTP Verification Alert */}
              <div className="pt-2 border-t border-indigo-100/70 flex items-center justify-between text-[11px]">
                {candidateProfile?.isPhoneVerified ? (
                  <div className="flex items-center gap-1.5 text-emerald-700 font-semibold">
                    <ShieldCheck size={13} strokeWidth={ICON_STROKE_WIDTH} className="text-emerald-600 shrink-0" />
                    <span>Mobile Verified {candidateProfile.phone ? `(${candidateProfile.phone.slice(-4).padStart(candidateProfile.phone.length, '•')})` : ''}</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between w-full gap-2">
                    <span className="text-amber-800 font-medium flex items-center gap-1">
                      <AlertTriangle size={12} strokeWidth={ICON_STROKE_WIDTH} className="text-amber-600 shrink-0" />
                      <span>Mobile unverified</span>
                    </span>
                    <button
                      onClick={() => {
                        onClose();
                        onOpenEditProfile();
                      }}
                      className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] shadow-2xs"
                    >
                      Verify with OTP
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Side Tabs Selector */}
            <div className="grid grid-cols-4 gap-1 mt-4 p-1 bg-[#E4E7EC]/60 rounded-lg text-xs font-semibold">
              <button
                onClick={() => setActiveTab('saved')}
                className={`py-1.5 rounded transition-all text-center flex flex-col items-center gap-0.5 ${
                  activeTab === 'saved'
                    ? 'bg-white text-[#12172B] shadow-xs'
                    : 'text-[#5B6478] hover:text-[#12172B]'
                }`}
              >
                <span>Saved</span>
                <span className="text-[10px] px-1.5 rounded-full bg-blue-50 text-[#2B4EE6]">
                  {savedJobIds.length}
                </span>
              </button>

              <button
                onClick={() => setActiveTab('applications')}
                className={`py-1.5 rounded transition-all text-center flex flex-col items-center gap-0.5 ${
                  activeTab === 'applications'
                    ? 'bg-white text-[#12172B] shadow-xs'
                    : 'text-[#5B6478] hover:text-[#12172B]'
                }`}
              >
                <span>Applied</span>
                <span className="text-[10px] px-1.5 rounded-full bg-emerald-50 text-[#0E9F6E]">
                  {applications.length}
                </span>
              </button>

              <button
                onClick={() => setActiveTab('resume')}
                className={`py-1.5 rounded transition-all text-center flex flex-col items-center gap-0.5 ${
                  activeTab === 'resume'
                    ? 'bg-white text-[#12172B] shadow-xs'
                    : 'text-[#5B6478] hover:text-[#12172B]'
                }`}
              >
                <span>Resume</span>
                <span className="text-[10px] text-[#5B6478]">CV</span>
              </button>

              <button
                onClick={() => setActiveTab('perks')}
                className={`py-1.5 rounded transition-all text-center flex flex-col items-center gap-0.5 ${
                  activeTab === 'perks'
                    ? 'bg-white text-[#12172B] shadow-xs'
                    : 'text-[#5B6478] hover:text-[#12172B]'
                }`}
              >
                <span>Quotas</span>
                <span className="text-[10px] text-amber-700">Perks</span>
              </button>
            </div>
          </div>

          {/* ── Main Tab Content ── */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* ── Tab 1: Saved Jobs ── */}
            {activeTab === 'saved' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-1 border-b border-[#E4E7EC]">
                  <h4 className="text-xs font-bold text-[#12172B] flex items-center gap-1.5">
                    <Bookmark size={ICON_SIZES.inline} strokeWidth={ICON_STROKE_WIDTH} className="text-[#2B4EE6]" />
                    <span>My Saved Jobs ({savedJobIds.length})</span>
                  </h4>
                  <span className="text-[11px] text-[#5B6478]">Private to your account</span>
                </div>

                {savedJobsDetails.length === 0 ? (
                  <div className="text-center py-12 px-4 space-y-3 bg-[#F7F8FA] rounded-xl border border-dashed border-[#E4E7EC]">
                    <div className="w-10 h-10 rounded-full bg-blue-50 text-[#2B4EE6] flex items-center justify-center mx-auto">
                      <Bookmark size={ICON_SIZES.section} strokeWidth={ICON_STROKE_WIDTH} />
                    </div>
                    <p className="text-xs text-[#5B6478] max-w-xs mx-auto">
                      You haven&apos;t saved any jobs yet. When exploring roles on the homepage, click the <strong>Save</strong> button to bookmark them here.
                    </p>
                    <button
                      onClick={onClose}
                      className="px-4 py-2 bg-[#2B4EE6] text-white text-xs font-semibold rounded-lg hover:bg-[#1E3BBD] transition-colors"
                    >
                      Browse Verified Jobs
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {savedJobsDetails.map((job) => (
                      <div
                        key={job.id}
                        className="p-3 bg-white rounded-xl border border-[#E4E7EC] hover:border-[#2B4EE6]/40 transition-colors shadow-2xs space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h5 className="text-xs font-bold text-[#12172B] line-clamp-1">{job.title}</h5>
                            <span className="text-[11px] font-medium text-[#5B6478]">{job.company}</span>
                          </div>
                          <button
                            onClick={() => onToggleSaveJob(job.id)}
                            className="text-[#5B6478] hover:text-red-600 p-1"
                            title="Remove from saved"
                          >
                            <Trash2 size={13} strokeWidth={ICON_STROKE_WIDTH} />
                          </button>
                        </div>

                        <div className="flex items-center gap-2 text-[10px] text-[#5B6478]">
                          <span className="bg-[#F7F8FA] px-2 py-0.5 rounded border border-[#E4E7EC]">
                            {job.location}
                          </span>
                          {job.workMode && (
                            <span className="bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded border border-emerald-200">
                              {job.workMode}
                            </span>
                          )}
                          {job.salary && <span>{job.salary}</span>}
                        </div>

                        <div className="pt-2 border-t border-[#E4E7EC] flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            {job.url && job.url !== '#' && (
                              <a
                                href={`/copilot?url=${encodeURIComponent(job.url)}`}
                                className="text-[11px] font-semibold text-[#0284c7] bg-[#f0f9ff] hover:bg-[#e0f2fe] border border-[#bae6fd] px-2 py-0.5 rounded inline-flex items-center gap-1 transition-colors"
                                title="Autofill form with NicheHire Co-Pilot"
                              >
                                <Sparkles size={11} strokeWidth={ICON_STROKE_WIDTH} className="text-[#0284c7]" />
                                <span>Co-Pilot</span>
                              </a>
                            )}
                            <a
                              href={job.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] font-semibold text-[#2B4EE6] hover:underline inline-flex items-center gap-1"
                            >
                              <span>Apply Direct</span>
                              <ExternalLink size={11} strokeWidth={ICON_STROKE_WIDTH} />
                            </a>
                          </div>

                          <button
                            onClick={() => {
                              const newApp: CandidateApplication = {
                                id: `app-${Date.now()}`,
                                company: job.company,
                                role: job.title,
                                location: job.location,
                                appliedDate: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
                                status: 'Applied',
                                portalUrl: job.url,
                              };
                              saveApplicationsToStorage([newApp, ...applications]);
                              setActiveTab('applications');
                            }}
                            className="text-[10px] font-medium text-[#0E9F6E] bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 rounded border border-emerald-200 transition-colors"
                          >
                            Mark as Applied
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Tab 2: My Applications ── */}
            {activeTab === 'applications' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-1 border-b border-[#E4E7EC]">
                  <div>
                    <h4 className="text-xs font-bold text-[#12172B] flex items-center gap-1.5">
                      <Briefcase size={ICON_SIZES.inline} strokeWidth={ICON_STROKE_WIDTH} className="text-[#0E9F6E]" />
                      <span>Application Tracker ({applications.length})</span>
                    </h4>
                    <span className="text-[11px] text-[#5B6478]">Status &amp; interview pipeline</span>
                  </div>

                  <button
                    onClick={() => setIsAddingApp(!isAddingApp)}
                    className="px-2.5 py-1 bg-[#2B4EE6] text-white text-[11px] font-semibold rounded-lg hover:bg-[#1E3BBD] transition-colors inline-flex items-center gap-1"
                  >
                    <Plus size={12} strokeWidth={ICON_STROKE_WIDTH} />
                    <span>Log Apply</span>
                  </button>
                </div>

                {/* Filter Pills */}
                <div className="flex items-center gap-1.5 text-[10px] overflow-x-auto pb-1">
                  {['all', 'pending', 'interview', 'Shortlisted', 'Offer Received'].map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilterAppStatus(f)}
                      className={`px-2 py-0.5 rounded-full capitalize whitespace-nowrap transition-colors ${
                        filterAppStatus === f
                          ? 'bg-[#12172B] text-white font-semibold'
                          : 'bg-[#F7F8FA] text-[#5B6478] hover:text-[#12172B] border border-[#E4E7EC]'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>

                {/* Inline Quick Add Form */}
                {isAddingApp && (
                  <form onSubmit={handleAddApplication} className="p-3 bg-blue-50/60 rounded-xl border border-blue-200 space-y-2">
                    <h5 className="text-[11px] font-bold text-[#12172B]">Log a Corporate Application</h5>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        required
                        placeholder="Company (e.g. Tata, Google)"
                        value={newCompany}
                        onChange={(e) => setNewCompany(e.target.value)}
                        className="px-2 py-1.5 bg-white border border-[#E4E7EC] rounded text-xs text-[#12172B]"
                      />
                      <input
                        type="text"
                        required
                        placeholder="Role / Title"
                        value={newRole}
                        onChange={(e) => setNewRole(e.target.value)}
                        className="px-2 py-1.5 bg-white border border-[#E4E7EC] rounded text-xs text-[#12172B]"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Location"
                        value={newLocation}
                        onChange={(e) => setNewLocation(e.target.value)}
                        className="px-2 py-1.5 bg-white border border-[#E4E7EC] rounded text-xs text-[#12172B]"
                      />
                      <select
                        value={newStatus}
                        onChange={(e) => setNewStatus(e.target.value as any)}
                        className="px-2 py-1.5 bg-white border border-[#E4E7EC] rounded text-xs text-[#12172B]"
                      >
                        <option value="Applied">Applied</option>
                        <option value="Under Review">Under Review</option>
                        <option value="Shortlisted">Shortlisted</option>
                        <option value="Interview Scheduled">Interview Scheduled</option>
                        <option value="Offer Received">Offer Received</option>
                      </select>
                    </div>
                    <input
                      type="url"
                      placeholder="Career portal or job link (optional)"
                      value={newPortalUrl}
                      onChange={(e) => setNewPortalUrl(e.target.value)}
                      className="w-full px-2 py-1.5 bg-white border border-[#E4E7EC] rounded text-xs text-[#12172B]"
                    />
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setIsAddingApp(false)}
                        className="text-[11px] text-[#5B6478] hover:text-[#12172B]"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-3 py-1 bg-[#2B4EE6] text-white text-[11px] font-semibold rounded hover:bg-[#1E3BBD]"
                      >
                        Save Application
                      </button>
                    </div>
                  </form>
                )}

                {/* Applications List */}
                {filteredApplications.length === 0 ? (
                  <div className="text-center py-8 text-xs text-[#5B6478] bg-[#F7F8FA] rounded-xl border border-dashed border-[#E4E7EC] p-4">
                    No applications tracked under this filter. Keep track of every corporate role you apply to right here.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {filteredApplications.map((app) => (
                      <div
                        key={app.id}
                        className="p-3 bg-white rounded-xl border border-[#E4E7EC] hover:border-[#12172B]/30 transition-colors shadow-2xs space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h5 className="text-xs font-bold text-[#12172B]">{app.role}</h5>
                            <span className="text-[11px] font-semibold text-[#5B6478]">{app.company}</span>
                          </div>
                          <button
                            onClick={() => handleDeleteApplication(app.id)}
                            className="text-[#5B6478] hover:text-red-600 p-1"
                            title="Delete application"
                          >
                            <Trash2 size={12} strokeWidth={ICON_STROKE_WIDTH} />
                          </button>
                        </div>

                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-[#5B6478]">{app.location} • Applied {app.appliedDate}</span>

                          {/* Status Picker */}
                          <select
                            value={app.status}
                            onChange={(e) => handleUpdateStatus(app.id, e.target.value as any)}
                            className={`px-2 py-0.5 text-[10px] font-bold rounded border ${
                              app.status === 'Interview Scheduled'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                : app.status === 'Shortlisted'
                                ? 'bg-purple-50 text-purple-800 border-purple-300'
                                : app.status === 'Under Review'
                                ? 'bg-amber-50 text-amber-800 border-amber-300'
                                : 'bg-blue-50 text-blue-800 border-blue-200'
                            }`}
                          >
                            <option value="Applied">Applied</option>
                            <option value="Under Review">Under Review</option>
                            <option value="Shortlisted">Shortlisted</option>
                            <option value="Interview Scheduled">Interview Scheduled</option>
                            <option value="Offer Received">Offer Received</option>
                            <option value="Archived">Archived</option>
                          </select>
                        </div>

                        {app.portalUrl && (
                          <div className="pt-1.5 border-t border-[#E4E7EC] flex items-center justify-between text-[10px]">
                            <a
                              href={app.portalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#2B4EE6] hover:underline inline-flex items-center gap-1"
                            >
                              <span>Official Career Portal</span>
                              <ExternalLink size={10} strokeWidth={ICON_STROKE_WIDTH} />
                            </a>
                            <span className="text-[#5B6478]">Direct Apply</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Tab 3: Resume & Skills ── */}
            {activeTab === 'resume' && (
              <div className="space-y-4">
                <div className="pb-1 border-b border-[#E4E7EC] flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-[#12172B] flex items-center gap-1.5">
                      <FileText size={ICON_SIZES.inline} strokeWidth={ICON_STROKE_WIDTH} className="text-[#2B4EE6]" />
                      <span>Resume &amp; Profile Data</span>
                    </h4>
                    <span className="text-[11px] text-[#5B6478]">Manage your CV, extracted credentials, and ATS readiness</span>
                  </div>
                  <button
                    onClick={() => {
                      onClose();
                      onOpenEditProfile();
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2B4EE6] hover:underline"
                  >
                    <Edit3 size={11} strokeWidth={ICON_STROKE_WIDTH} />
                    <span>Edit Profile</span>
                  </button>
                </div>

                {/* Uploaded Resume Card */}
                <div className="p-3.5 bg-gradient-to-r from-blue-50/80 to-indigo-50/60 border border-blue-200/80 rounded-xl space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-[#2B4EE6] text-white flex items-center justify-center shrink-0">
                        <Upload size={14} strokeWidth={ICON_STROKE_WIDTH} />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-[#12172B]">Uploaded Resume (CV)</span>
                        <p className="text-[10px] text-[#5B6478]">
                          Used for 1-click apply and recruiter searches
                        </p>
                      </div>
                    </div>

                    <label className="cursor-pointer px-2.5 py-1 bg-[#2B4EE6] hover:bg-[#1E3BBD] text-white text-[11px] font-semibold rounded-lg transition-colors flex items-center gap-1 shadow-2xs">
                      <span>{isUploadingInDrawer ? 'Parsing...' : uploadedResume ? 'Replace' : 'Upload'}</span>
                      <input
                        type="file"
                        accept=".pdf,.docx,.doc,.txt"
                        className="hidden"
                        disabled={isUploadingInDrawer}
                        onChange={handleDrawerResumeUpload}
                      />
                    </label>
                  </div>

                  {uploadedResume ? (
                    <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-blue-100 text-[11px]">
                      <div className="flex items-center gap-2 truncate">
                        <FileText size={13} strokeWidth={ICON_STROKE_WIDTH} className="text-[#2B4EE6] shrink-0" />
                        <span className="font-semibold text-[#12172B] truncate">{uploadedResume.fileName}</span>
                        <span className="text-[10px] text-[#5B6478] shrink-0">({uploadedResume.fileSize})</span>
                      </div>
                      <span className="text-[10px] font-bold text-[#0E9F6E] bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 shrink-0">
                        Synced
                      </span>
                    </div>
                  ) : (
                    <div className="p-2.5 bg-white/70 rounded-lg border border-dashed border-blue-200 text-center">
                      <p className="text-[11px] text-[#5B6478]">
                        No resume uploaded yet. Upload a PDF or Word doc to auto-fill your profile details.
                      </p>
                    </div>
                  )}

                  {drawerUploadNotice && (
                    <div className="p-2 bg-emerald-50 text-emerald-900 border border-emerald-200 rounded text-[11px] flex items-center gap-1.5 font-medium">
                      <CheckCircle2 size={12} strokeWidth={ICON_STROKE_WIDTH} className="text-[#0E9F6E] shrink-0" />
                      <span>{drawerUploadNotice}</span>
                    </div>
                  )}
                </div>

                {/* Profile Details Summary */}
                <div className="bg-[#F7F8FA] p-3.5 rounded-xl border border-[#E4E7EC] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-[#5B6478] tracking-wider">Profile Credentials</span>
                    <button
                      onClick={() => {
                        onClose();
                        onOpenEditProfile();
                      }}
                      className="text-[11px] text-[#2B4EE6] font-semibold hover:underline"
                    >
                      Update
                    </button>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#5B6478] tracking-wider">Education</span>
                    <p className="text-xs font-semibold text-[#12172B] mt-0.5">
                      {candidateProfile?.degree || 'Degree not configured yet'}
                    </p>
                    <p className="text-[11px] text-[#5B6478]">
                      {candidateProfile?.institution ? (
                        `${candidateProfile.institution}${candidateProfile.gradYear ? ` • Class of ${candidateProfile.gradYear}` : ''}`
                      ) : (
                        'Institution not added yet'
                      )}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-[#E4E7EC]">
                    <span className="text-[10px] uppercase font-bold text-[#5B6478] tracking-wider">Experience &amp; CTC</span>
                    <p className="text-xs font-medium text-[#12172B] mt-0.5">
                      {candidateProfile?.experienceLevel || 'Experience not specified'}
                      {candidateProfile?.expectedCtc ? ` • Expected: ${candidateProfile.expectedCtc}` : ''}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-[#E4E7EC]">
                    <span className="text-[10px] uppercase font-bold text-[#5B6478] tracking-wider">Key Skills</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {candidateProfile?.skills && candidateProfile.skills.length > 0 ? (
                        candidateProfile.skills.map((s: string) => (
                          <span key={s} className="px-2 py-0.5 bg-white border border-[#E4E7EC] rounded text-[10px] text-[#12172B] font-medium">
                            {s}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-[#5B6478] italic">No skills listed yet. Click Edit Profile to add skills across your stream.</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="space-y-2">
                  <button
                    onClick={() => {
                      onClose();
                      onOpenResumeBuilder();
                    }}
                    className="w-full py-2.5 bg-[#2B4EE6] hover:bg-[#1E3BBD] text-white text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-xs"
                  >
                    <FileText size={ICON_SIZES.inline} strokeWidth={ICON_STROKE_WIDTH} />
                    <span>Open Simple Resume Builder (PDF)</span>
                  </button>

                  <button
                    onClick={() => {
                      onClose();
                      onOpenCareerGuidance();
                    }}
                    className="w-full py-2 bg-white hover:bg-[#F7F8FA] border border-[#E4E7EC] text-[#12172B] text-xs font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    <Sparkles size={ICON_SIZES.inline} strokeWidth={ICON_STROKE_WIDTH} className="text-[#2B4EE6]" />
                    <span>Generate AI Career Strategy Report</span>
                  </button>
                </div>
              </div>
            )}

            {/* ── Tab 4: Perks & Quotas ── */}
            {activeTab === 'perks' && (
              <div className="space-y-4">
                <div className="pb-1 border-b border-[#E4E7EC]">
                  <h4 className="text-xs font-bold text-[#12172B]">Membership Privileges &amp; Quotas</h4>
                  <span className="text-[11px] text-[#5B6478]">Your active monthly allotment</span>
                </div>

                {/* Quota Cycle Countdown Alert */}
                <div className="p-3 bg-indigo-50/80 border border-indigo-200 rounded-xl flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Clock size={14} strokeWidth={ICON_STROKE_WIDTH} className="text-[#2B4EE6]" />
                    <span className="font-semibold text-gray-900">Monthly Allotment Cycle</span>
                  </div>
                  <span className="font-bold text-[#2B4EE6] bg-white px-2.5 py-0.5 rounded-full border border-indigo-200 text-[11px]">
                    ⏱️ {candidateDaysLeft} {candidateDaysLeft === 1 ? 'day' : 'days'} remaining
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-[#F7F8FA] rounded-xl border border-[#E4E7EC] space-y-1">
                    <span className="text-[11px] text-[#5B6478]">Resume Tailoring</span>
                    <div className="text-lg font-bold text-[#12172B]">
                      {accessStatus?.quotaBypass ? 'Unlimited' : `${accessStatus?.remainingQuotas?.tailoredResumes ?? 5} left`}
                    </div>
                    <span className="text-[10px] text-[#0E9F6E]">ATS Optimized</span>
                  </div>

                  <div className="p-3 bg-[#F7F8FA] rounded-xl border border-[#E4E7EC] space-y-1">
                    <span className="text-[11px] text-[#5B6478]">HR Outreach Drafts</span>
                    <div className="text-lg font-bold text-[#12172B]">
                      {accessStatus?.quotaBypass ? 'Unlimited' : `${accessStatus?.remainingQuotas?.hrEmailDrafts ?? 5} left`}
                    </div>
                    <span className="text-[10px] text-blue-600">Direct Recruiter</span>
                  </div>
                </div>

                <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl space-y-2">
                  <span className="text-xs font-bold text-amber-900 block">Referral Link &amp; Free Unlimited Pass</span>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    Invite fellow students or colleagues. Refer 10 friends to unlock the Rising Tier, or 50 for VIP Gold status with unlimited AI tools.
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      readOnly
                      value={accessStatus?.referralCode ? `https://www.nichehire.tech/?ref=${accessStatus.referralCode}` : 'https://www.nichehire.tech/?ref=NICHE2026'}
                      className="flex-1 px-2.5 py-1.5 bg-white border border-amber-300 rounded text-[11px] text-[#12172B]"
                    />
                    <button
                      onClick={() => {
                        const link = accessStatus?.referralCode
                          ? `${window.location.origin}/?ref=${accessStatus.referralCode}`
                          : 'https://www.nichehire.tech';
                        navigator.clipboard.writeText(link);
                        alert('Referral link copied to clipboard!');
                      }}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-[11px] font-semibold"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                <div className="pt-2">
                  <Link
                    href="/dashboard"
                    onClick={onClose}
                    className="block text-center py-2 px-3 bg-white border border-[#E4E7EC] hover:bg-[#F7F8FA] rounded-xl text-xs font-semibold text-[#2B4EE6] transition-colors"
                  >
                    View Comprehensive Candidate Dashboard Page &rarr;
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* ── Drawer Bottom Footer ── */}
          <div className="p-4 border-t border-[#E4E7EC] bg-[#F7F8FA] flex items-center justify-between text-xs">
            <button
              onClick={() => {
                onClose();
                onOpenTour();
              }}
              className="text-[#5B6478] hover:text-[#12172B] inline-flex items-center gap-1.5 font-medium"
            >
              <HelpCircle size={14} strokeWidth={ICON_STROKE_WIDTH} />
              <span>Platform Tour</span>
            </button>

            <button
              onClick={() => {
                onClose();
                onSignOut();
              }}
              className="text-red-600 hover:text-red-700 font-medium inline-flex items-center gap-1.5"
            >
              <LogOut size={14} strokeWidth={ICON_STROKE_WIDTH} />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

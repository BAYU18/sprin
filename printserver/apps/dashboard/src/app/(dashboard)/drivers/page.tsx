'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Server,
    Info,
    ShieldAlert,
    Cpu,
    Download,
    Check,
    Trash2,
    Edit,
    Plus,
    RefreshCw,
    Search,
    Link as LinkIcon
} from 'lucide-react';

import { drivers as driversApi, printers as printersApi } from '@/lib/api';

interface Driver {
    id: number;
    name: string;
    manufacturer: string | null;
    description: string | null;
    is_builtin: boolean;
    install_instructions: string | null;
    download_url: string | null;
    usage_count: number;
    created_at: string;
    updated_at: string;
}

interface Printer {
    id: number;
    name: string;
    slug: string;
    status: string;
    client_id: number | null;
    driver_id: number | null;
    driver_name: string | null;
    client_hostname: string | null;
}

export default function DriversPage() {
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [printers, setPrinters] = useState<Printer[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [filter, setFilter] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const [hoveredDriverId, setHoveredDriverId] = useState<number | null>(null);
    const [hoveredPrinterId, setHoveredPrinterId] = useState<number | null>(null);

    const loadData = useCallback(async () => {
        try {
            const [dRes, pRes] = await Promise.all([
                driversApi.list().then(r => r.data),
                printersApi.list().then(r => r.data),
            ]);
            setDrivers(Array.isArray(dRes) ? dRes : []);
            setPrinters(Array.isArray(pRes) ? pRes : []);
        } catch (e: any) {
            setError(`Failed to load: ${e.message}`);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleAddDriver = async (data: any) => {
        setError(null);
        try {
            if (data.fileData) {
                await driversApi.upload(data);
            } else {
                await driversApi.create(data);
            }
            setSuccess(data.fileData ? `Driver ZIP "${data.name}" uploaded successfully` : `Driver "${data.name}" added`);
            setShowAddModal(false);
            loadData();
            setTimeout(() => setSuccess(null), 3000);
        } catch (e: any) {
            setError(e.response?.data?.error || e.message || 'Failed to add');
        }
    };

    const handleDeleteDriver = async (id: number, name: string) => {
        if (!confirm(`Delete driver "${name}"?`)) return;
        try {
            await driversApi.delete(id);
            setSuccess(`Driver deleted`);
            loadData();
            setTimeout(() => setSuccess(null), 3000);
        } catch (e: any) {
            setError(e.response?.data?.error || e.message || 'Failed to delete');
        }
    };

    const handleAssignDriver = async (printerId: number, driverId: number | null) => {
        try {
            await driversApi.assignToPrinter(printerId, driverId);
            setSuccess(driverId ? 'Driver assigned' : 'Driver unassigned');
            loadData();
            setTimeout(() => setSuccess(null), 2000);
        } catch (e: any) {
            setError(e.response?.data?.error || e.message || 'Failed to assign');
        }
    };

    const handleAutoAssign = async () => {
        if (!confirm('Auto-assign drivers to unassigned printers based on name match?')) return;
        try {
            const result = (await driversApi.autoAssign('name-contains')).data;
            setSuccess(`Auto-assigned ${result.assigned} of ${result.total} printers`);
            loadData();
            setTimeout(() => setSuccess(null), 3000);
        } catch (e: any) {
            setError(e.response?.data?.error || e.message || 'Failed to auto-assign');
        }
    };

    const filtered = drivers.filter(d =>
        (d.name || '').toLowerCase().includes(filter.toLowerCase()) ||
        (d.manufacturer || '').toLowerCase().includes(filter.toLowerCase())
    );

    const builtinCount = drivers.filter(d => d.is_builtin).length;
    const customCount = drivers.length - builtinCount;
    const unassignedPrinters = printers.filter(p => p.client_id && !p.driver_id);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Header */}
            <div>
                <h1 style={{ fontSize: '26px', fontWeight: 700, fontFamily: 'Rajdhani, sans-serif', color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Server style={{ width: '28px', height: '28px', color: 'var(--accent-cyan)' }} />
                    Driver Management
                </h1>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
                    Catalog of Windows printer drivers and their assignments to printers.
                </p>
            </div>

            {/* Stats */}
            <div className="stat-cards">
                <div className="stat-card">
                    <div className="stat-card-header">
                        <Server className="stat-icon" style={{ color: 'var(--accent-cyan)' }} />
                        <span className="stat-badge cyan">Total</span>
                    </div>
                    <div className="stat-value">{drivers.length}</div>
                    <div className="stat-label">Total Drivers</div>
                    <div className="stat-progress">
                        <div className="stat-progress-bar" style={{ width: '100%', background: 'var(--accent-cyan)' }} />
                    </div>
                    <div className="stat-subtext">Registered printer drivers</div>
                </div>

                <div className="stat-card">
                    <div className="stat-card-header">
                        <Cpu className="stat-icon" style={{ color: 'var(--accent-green)' }} />
                        <span className="stat-badge green">Built-in</span>
                    </div>
                    <div className="stat-value">{builtinCount}</div>
                    <div className="stat-label">Built-in</div>
                    <div className="stat-progress">
                        <div className="stat-progress-bar" style={{ width: `${drivers.length ? (builtinCount / drivers.length) * 100 : 0}%`, background: 'var(--accent-green)' }} />
                    </div>
                    <div className="stat-subtext">System default drivers</div>
                </div>

                <div className="stat-card">
                    <div className="stat-card-header">
                        <Download className="stat-icon" style={{ color: 'var(--accent-amber)' }} />
                        <span className="stat-badge amber">Custom</span>
                    </div>
                    <div className="stat-value">{customCount}</div>
                    <div className="stat-label">Custom Uploads</div>
                    <div className="stat-progress">
                        <div className="stat-progress-bar" style={{ width: `${drivers.length ? (customCount / drivers.length) * 100 : 0}%`, background: 'var(--accent-amber)' }} />
                    </div>
                    <div className="stat-subtext">Administrator added</div>
                </div>

                <div className="stat-card">
                    <div className="stat-card-header">
                        <ShieldAlert className="stat-icon" style={{ color: 'var(--accent-red)' }} />
                        <span className="stat-badge" style={{ background: 'rgba(255, 61, 90, 0.15)', border: '1px solid rgba(255, 61, 90, 0.4)', color: 'var(--accent-red)', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', padding: '4px 10px', borderRadius: '12px' }}>Unassigned</span>
                    </div>
                    <div className="stat-value">{unassignedPrinters.length}</div>
                    <div className="stat-label">Unassigned</div>
                    <div className="stat-progress">
                        <div className="stat-progress-bar" style={{ width: `${printers.length ? (unassignedPrinters.length / printers.length) * 100 : 0}%`, background: 'var(--accent-red)' }} />
                    </div>
                    <div className="stat-subtext">Need driver mapping</div>
                </div>
            </div>

            {/* Notifications */}
            {error && (
                <div style={{ background: 'rgba(255, 61, 90, 0.1)', border: '1px solid rgba(255, 61, 90, 0.3)', color: 'var(--accent-red)', padding: '12px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', fontSize: '14px', marginBottom: '16px' }}>
                    <span>{error}</span>
                    <button onClick={() => setError(null)} style={{ background: 'transparent', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold' }}>×</button>
                </div>
            )}
            {success && (
                <div style={{ background: 'rgba(0, 255, 136, 0.1)', border: '1px solid rgba(0, 255, 136, 0.3)', color: 'var(--accent-green)', padding: '12px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px', marginBottom: '16px' }}>
                    <Check style={{ width: '16px', height: '16px', color: 'var(--accent-green)' }} />
                    <span>{success}</span>
                </div>
            )}

            {/* Dual-Section Layout */}
            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'stretch' }}>
                
                {/* Left Column: Driver Catalog */}
                <div style={{ flex: '1.4 1 600px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                            <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Rajdhani, sans-serif', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                                <Cpu style={{ width: '20px', height: '20px', color: 'var(--accent-cyan)' }} />
                                Driver Catalog ({filtered.length})
                            </h2>
                        </div>

                        {/* Search and Action Bar */}
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: '1 1 200px' }}>
                                <Search style={{ position: 'absolute', left: '12px', width: '16px', height: '16px', color: 'var(--text-muted)' }} />
                                <input
                                    type="text"
                                    placeholder="Filter catalog..."
                                    value={filter}
                                    onChange={e => setFilter(e.target.value)}
                                    className="input"
                                    style={{ paddingLeft: '36px', height: '40px', fontSize: '14px' }}
                                />
                            </div>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                <button
                                    onClick={handleAutoAssign}
                                    className="btn-primary"
                                    style={{
                                        background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.1) 0%, rgba(236, 72, 153, 0.1) 100%)',
                                        borderColor: '#a855f7',
                                        color: '#d8b4fe',
                                        height: '40px',
                                        fontSize: '13px',
                                        fontWeight: 600,
                                        padding: '8px 16px',
                                        borderRadius: '8px',
                                        cursor: 'pointer'
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(168, 85, 247, 0.2)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(168, 85, 247, 0.1)'; }}
                                >
                                    <RefreshCw style={{ width: '16px', height: '16px', marginRight: '6px' }} />
                                    Auto-Assign
                                </button>
                                <button
                                    onClick={() => setShowAddModal(true)}
                                    className="btn-primary"
                                    style={{
                                        background: 'linear-gradient(135deg, rgba(0, 212, 255, 0.1) 0%, rgba(0, 255, 136, 0.1) 100%)',
                                        borderColor: 'var(--accent-cyan)',
                                        height: '40px',
                                        fontSize: '13px',
                                        fontWeight: 600,
                                        padding: '8px 16px',
                                        borderRadius: '8px',
                                        cursor: 'pointer'
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0, 212, 255, 0.2)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0, 212, 255, 0.1)'; }}
                                >
                                    <Plus style={{ width: '16px', height: '16px', marginRight: '6px' }} />
                                    Add Driver
                                </button>
                            </div>
                        </div>

                        {/* Driver Catalog Table */}
                        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-secondary)' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', fontFamily: 'IBM Plex Sans, sans-serif' }}>
                                <thead>
                                    <tr style={{ background: 'rgba(0, 0, 0, 0.2)', borderBottom: '1px solid var(--border)' }}>
                                        <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'left', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '1px' }}>Driver Name</th>
                                        <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'left', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '1px' }}>Manufacturer</th>
                                        <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'left', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '1px' }}>Type</th>
                                        <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '1px' }}>Usage</th>
                                        <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '1px' }}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading ? (
                                        <tr>
                                            <td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                                                    <div className="loading-spinner" style={{ width: '24px', height: '24px' }} />
                                                    <span>Loading drivers...</span>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : filtered.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                                No drivers found in catalog
                                            </td>
                                        </tr>
                                    ) : (
                                        filtered.map((d, idx) => (
                                            <tr
                                                key={d.id}
                                                onMouseEnter={() => setHoveredDriverId(d.id)}
                                                onMouseLeave={() => setHoveredDriverId(null)}
                                                style={{
                                                    borderBottom: '1px solid var(--border)',
                                                    backgroundColor: hoveredDriverId === d.id ? 'var(--bg-hover)' : (idx % 2 === 0 ? 'transparent' : 'rgba(0, 212, 255, 0.01)'),
                                                    transition: 'background-color 0.2s'
                                                }}
                                            >
                                                <td style={{ padding: '12px 16px' }}>
                                                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{d.name}</div>
                                                    {d.description && (
                                                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.description}>
                                                            {d.description}
                                                        </div>
                                                    )}
                                                </td>
                                                <td style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>{d.manufacturer || '—'}</td>
                                                <td style={{ padding: '12px 16px' }}>
                                                    {d.is_builtin ? (
                                                        <span className="stat-badge green" style={{ padding: '2px 8px', fontSize: '11px', borderRadius: '4px' }}>Built-in</span>
                                                    ) : (
                                                        <span className="stat-badge cyan" style={{ padding: '2px 8px', fontSize: '11px', borderRadius: '4px' }}>Custom</span>
                                                    )}
                                                </td>
                                                <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: d.usage_count > 0 ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                                                    {d.usage_count}
                                                </td>
                                                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                                                    {d.usage_count === 0 && !d.is_builtin ? (
                                                        <button
                                                            onClick={() => handleDeleteDriver(d.id, d.name)}
                                                            style={{
                                                                background: 'rgba(255, 61, 90, 0.1)',
                                                                border: '1px solid rgba(255, 61, 90, 0.3)',
                                                                color: 'var(--accent-red)',
                                                                padding: '6px 12px',
                                                                borderRadius: '6px',
                                                                cursor: 'pointer',
                                                                fontSize: '12px',
                                                                fontWeight: 600,
                                                                transition: 'all 0.2s',
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                gap: '4px'
                                                            }}
                                                            onMouseEnter={e => {
                                                                e.currentTarget.style.background = 'rgba(255, 61, 90, 0.2)';
                                                                e.currentTarget.style.boxShadow = 'var(--glow-red)';
                                                            }}
                                                            onMouseLeave={e => {
                                                                e.currentTarget.style.background = 'rgba(255, 61, 90, 0.1)';
                                                                e.currentTarget.style.boxShadow = 'none';
                                                            }}
                                                        >
                                                            <Trash2 style={{ width: '12px', height: '12px' }} />
                                                            Delete
                                                        </button>
                                                    ) : d.is_builtin ? (
                                                        <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontStyle: 'italic' }}>Protected</span>
                                                    ) : (
                                                        <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontStyle: 'italic' }}>Active</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Right Column: Printer Driver Assignment */}
                <div style={{ flex: '1 1 400px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
                        <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Rajdhani, sans-serif', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase', letterSpacing: '1px', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
                            <LinkIcon style={{ width: '20px', height: '20px', color: 'var(--accent-cyan)' }} />
                            Printer Driver Assignment
                        </h2>

                        {/* Printer Table */}
                        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-secondary)' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', fontFamily: 'IBM Plex Sans, sans-serif' }}>
                                <thead>
                                    <tr style={{ background: 'rgba(0, 0, 0, 0.2)', borderBottom: '1px solid var(--border)' }}>
                                        <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'left', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '1px' }}>Printer</th>
                                        <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'left', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '1px' }}>Assigned Driver</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading ? (
                                        <tr>
                                            <td colSpan={2} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                                                    <div className="loading-spinner" style={{ width: '24px', height: '24px' }} />
                                                    <span>Loading printers...</span>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : printers.filter(p => p.client_id).length === 0 ? (
                                        <tr>
                                            <td colSpan={2} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                                No connected printers found
                                            </td>
                                        </tr>
                                    ) : (
                                        printers.filter(p => p.client_id).map((p, idx) => (
                                            <tr
                                                key={p.id}
                                                onMouseEnter={() => setHoveredPrinterId(p.id)}
                                                onMouseLeave={() => setHoveredPrinterId(null)}
                                                style={{
                                                    borderBottom: '1px solid var(--border)',
                                                    backgroundColor: hoveredPrinterId === p.id ? 'var(--bg-hover)' : (idx % 2 === 0 ? 'transparent' : 'rgba(0, 212, 255, 0.01)'),
                                                    transition: 'background-color 0.2s'
                                                }}
                                            >
                                                <td style={{ padding: '12px 16px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <span
                                                            style={{
                                                                width: '8px',
                                                                height: '8px',
                                                                borderRadius: '50%',
                                                                backgroundColor: p.status === 'online' ? 'var(--accent-green)' : 'var(--accent-red)',
                                                                boxShadow: p.status === 'online' ? 'var(--glow-green)' : 'var(--glow-red)',
                                                                display: 'inline-block'
                                                            }}
                                                        />
                                                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</span>
                                                    </div>
                                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px', marginLeft: '16px' }}>
                                                        {p.client_hostname || '—'}
                                                    </div>
                                                </td>
                                                <td style={{ padding: '12px 16px' }}>
                                                    <select
                                                        value={p.driver_id || ''}
                                                        onChange={e => handleAssignDriver(p.id, e.target.value ? parseInt(e.target.value) : null)}
                                                        style={{
                                                            background: 'var(--bg-secondary)',
                                                            border: '1px solid var(--border)',
                                                            color: 'var(--text-primary)',
                                                            padding: '8px 12px',
                                                            borderRadius: '8px',
                                                            fontSize: '13px',
                                                            width: '100%',
                                                            outline: 'none',
                                                            cursor: 'pointer',
                                                            fontFamily: 'IBM Plex Sans, sans-serif'
                                                        }}
                                                        onFocus={e => {
                                                            e.currentTarget.style.borderColor = 'var(--accent-cyan)';
                                                            e.currentTarget.style.boxShadow = 'var(--glow-cyan)';
                                                        }}
                                                        onBlur={e => {
                                                            e.currentTarget.style.borderColor = 'var(--border)';
                                                            e.currentTarget.style.boxShadow = 'none';
                                                        }}
                                                    >
                                                        <option value="">— Unassigned (fallback) —</option>
                                                        {drivers.map(d => (
                                                            <option key={d.id} value={d.id}>
                                                                {d.name} {d.is_builtin ? '✓' : ''}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

            </div>

            {/* Add Driver Modal */}
            {showAddModal && (
                <AddDriverModal
                    onClose={() => setShowAddModal(false)}
                    onSubmit={handleAddDriver}
                />
            )}
        </div>
    );
}

function AddDriverModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (data: any) => void }) {
    const [name, setName] = useState('');
    const [manufacturer, setManufacturer] = useState('');
    const [description, setDescription] = useState('');
    const [downloadUrl, setDownloadUrl] = useState('');
    const [installInstructions, setInstallInstructions] = useState('');

    const [uploadMethod, setUploadMethod] = useState<'url' | 'file'>('url');
    const [file, setFile] = useState<File | null>(null);
    const [fileBase64, setFileBase64] = useState<string>('');
    const [readingFile, setReadingFile] = useState(false);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;

        setFile(selectedFile);
        setReadingFile(true);

        const reader = new FileReader();
        reader.onload = (event) => {
            const base64String = (event.target?.result as string).split(',')[1];
            setFileBase64(base64String);
            setReadingFile(false);
            
            // Auto fill driver name if empty
            if (!name) {
                const cleanName = selectedFile.name.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
                setName(cleanName);
            }
        };
        reader.onerror = () => {
            alert('Failed to read file');
            setReadingFile(false);
        };
        reader.readAsDataURL(selectedFile);
    };

    const handleSave = () => {
        if (!name.trim()) return;

        if (uploadMethod === 'file') {
            if (!file || !fileBase64) {
                alert('Please select a ZIP driver file first');
                return;
            }
            onSubmit({
                name,
                manufacturer,
                description,
                install_instructions: installInstructions,
                filename: file.name,
                fileData: fileBase64
            });
        } else {
            onSubmit({
                name,
                manufacturer,
                description,
                download_url: downloadUrl,
                install_instructions: installInstructions
            });
        }
    };

    const isSubmitDisabled = !name.trim() || readingFile || (uploadMethod === 'file' && !file);

    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.75)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 999,
                padding: '16px',
                backdropFilter: 'blur(4px)'
            }}
            onClick={onClose}
        >
            <div
                className="card"
                style={{
                    width: '100%',
                    maxWidth: '520px',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    padding: '24px',
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px'
                }}
                onClick={e => e.stopPropagation()}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Rajdhani, sans-serif', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                        <Plus style={{ width: '20px', height: '20px', color: 'var(--accent-cyan)' }} />
                        Add New Driver
                    </h3>
                    <button
                        onClick={onClose}
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '20px', cursor: 'pointer' }}
                    >
                        ×
                    </button>
                </div>

                {/* Tab selector */}
                <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '8px' }}>
                    <button
                        onClick={() => setUploadMethod('url')}
                        style={{
                            flex: 1,
                            padding: '10px',
                            background: 'transparent',
                            border: 'none',
                            color: uploadMethod === 'url' ? 'var(--accent-cyan)' : 'var(--text-muted)',
                            borderBottom: uploadMethod === 'url' ? '2px solid var(--accent-cyan)' : 'none',
                            fontSize: '13px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px'
                        }}
                    >
                        Remote URL Link
                    </button>
                    <button
                        onClick={() => setUploadMethod('file')}
                        style={{
                            flex: 1,
                            padding: '10px',
                            background: 'transparent',
                            border: 'none',
                            color: uploadMethod === 'file' ? 'var(--accent-cyan)' : 'var(--text-muted)',
                            borderBottom: uploadMethod === 'file' ? '2px solid var(--accent-cyan)' : 'none',
                            fontSize: '13px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px'
                        }}
                    >
                        Upload ZIP File
                    </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {uploadMethod === 'file' ? (
                        <div>
                            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', display: 'block', marginBottom: '6px' }}>
                                Select Driver ZIP File *
                            </label>
                            <input
                                type="file"
                                accept=".zip"
                                onChange={handleFileChange}
                                style={{
                                    width: '100%',
                                    padding: '10px',
                                    border: '1px dashed var(--border)',
                                    background: 'var(--bg-secondary)',
                                    borderRadius: '8px',
                                    color: 'var(--text-primary)',
                                    fontSize: '13px',
                                    cursor: 'pointer'
                                }}
                            />
                            {readingFile && (
                                <p style={{ fontSize: '11px', color: 'var(--accent-cyan)', marginTop: '6px' }}>
                                    Processing and encoding ZIP archive...
                                </p>
                            )}
                            {file && !readingFile && (
                                <p style={{ fontSize: '11px', color: 'var(--accent-green)', marginTop: '6px' }}>
                                    Selected: {file.name} ({(file.size / (1024 * 1024)).toFixed(2)} MB)
                                </p>
                            )}
                        </div>
                    ) : (
                        <div>
                            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', display: 'block', marginBottom: '6px' }}>Download URL</label>
                            <input
                                type="url"
                                value={downloadUrl}
                                onChange={e => setDownloadUrl(e.target.value)}
                                placeholder="https://manufacturer.com/drivers/..."
                                className="input"
                                style={{ height: '40px', fontSize: '14px' }}
                            />
                        </div>
                    )}

                    <div>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', display: 'block', marginBottom: '6px' }}>Driver Name *</label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="e.g. HP LaserJet M404"
                            className="input"
                            style={{ height: '40px', fontSize: '14px' }}
                        />
                        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>The exact name as it appears in Windows 'Print Management'</p>
                    </div>
                    <div>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', display: 'block', marginBottom: '6px' }}>Manufacturer</label>
                        <input
                            type="text"
                            value={manufacturer}
                            onChange={e => setManufacturer(e.target.value)}
                            placeholder="e.g. HP, EPSON, Canon"
                            className="input"
                            style={{ height: '40px', fontSize: '14px' }}
                        />
                    </div>
                    <div>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', display: 'block', marginBottom: '6px' }}>Description</label>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Short description of the driver"
                            className="input"
                            style={{ minHeight: '60px', fontSize: '14px', resize: 'vertical' }}
                            rows={2}
                        />
                    </div>
                    <div>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', display: 'block', marginBottom: '6px' }}>Install Instructions</label>
                        <textarea
                            value={installInstructions}
                            onChange={e => setInstallInstructions(e.target.value)}
                            placeholder="Steps to install on target Windows..."
                            className="input"
                            style={{ minHeight: '60px', fontSize: '14px', resize: 'vertical' }}
                            rows={2}
                        />
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: '16px', marginTop: '8px' }}>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'transparent',
                            border: '1px solid var(--border)',
                            color: 'var(--text-primary)',
                            padding: '8px 16px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontWeight: 600,
                            fontSize: '13px',
                            textTransform: 'uppercase',
                            letterSpacing: '1px',
                            transition: 'all 0.2s'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--border-hover)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--border)'; }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSubmitDisabled}
                        className="btn-primary"
                        style={{
                            opacity: isSubmitDisabled ? 0.5 : 1,
                            pointerEvents: isSubmitDisabled ? 'none' : 'auto',
                            padding: '8px 16px',
                            fontSize: '13px'
                        }}
                    >
                        {uploadMethod === 'file' ? 'Upload & Add' : 'Add Driver'}
                    </button>
                </div>
            </div>
        </div>
    );
}

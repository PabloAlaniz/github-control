import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '../components/templates/DashboardLayout';
import { ActivityFeed } from '../components/organisms/ActivityFeed';
import { Card } from '../components/atoms/Card';
import { Text } from '../components/atoms/Text';
import { Button } from '../components/atoms/Button';
import { ColorDot } from '../components/atoms/ColorDot';
import { Select } from '../components/atoms/Select';
import { ArrowLeft, Activity, Users, Calendar, TrendingUp, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { logout } from '../lib/auth';

export function ActivityPage() {
    const navigate = useNavigate();
    const [stats, setStats] = useState([]);
    const [dailyStats, setDailyStats] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const [actorRes, dailyRes] = await Promise.all([
                    apiFetch('/api/activity/stats/by-actor'),
                    apiFetch('/api/activity/stats/by-day?days=7')
                ]);
                
                // The API wraps each list: { actors: [...] } and { days: [...] }.
                if (actorRes.ok) setStats((await actorRes.json())?.actors ?? []);
                if (dailyRes.ok) setDailyStats((await dailyRes.json())?.days ?? []);
            } catch (err) {
                console.error('Failed to fetch stats:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchStats();
    }, []);

    const totalActions = stats.reduce((sum, s) => sum + s.totalActions, 0);
    const agentActions = stats.filter(s => s.actorType === 'agent').reduce((sum, s) => sum + s.totalActions, 0);
    const humanActions = stats.filter(s => s.actorType === 'human').reduce((sum, s) => sum + s.totalActions, 0);

    return (
        <DashboardLayout
            stats={
                <div className="space-y-4">
                    <header className="flex items-center gap-4">
                        <Button 
                            variant="ghost" 
                            onClick={() => navigate('/')}
                            className="gap-2"
                        >
                            <ArrowLeft size={16} />
                            Back
                        </Button>
                        <div className="flex-1">
                            <Text variant="h2">Activity Log</Text>
                            <Text variant="muted">Track all changes to repos and groups</Text>
                        </div>
                        <Button onClick={() => { logout(); navigate('/login'); }} variant="ghost" className="gap-2">
                            <LogOut size={16} /> Logout
                        </Button>
                    </header>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <Card className="p-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-blue-100">
                                    <Activity size={20} className="text-blue-600" />
                                </div>
                                <div>
                                    <Text variant="muted" className="text-xs">Total Actions</Text>
                                    <Text variant="h3">{totalActions}</Text>
                                </div>
                            </div>
                        </Card>
                        
                        <Card className="p-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-indigo-100">
                                    <Users size={20} className="text-indigo-600" />
                                </div>
                                <div>
                                    <Text variant="muted" className="text-xs">By Agents</Text>
                                    <Text variant="h3">{agentActions}</Text>
                                </div>
                            </div>
                        </Card>
                        
                        <Card className="p-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-amber-100">
                                    <Users size={20} className="text-amber-600" />
                                </div>
                                <div>
                                    <Text variant="muted" className="text-xs">By Humans</Text>
                                    <Text variant="h3">{humanActions}</Text>
                                </div>
                            </div>
                        </Card>
                        
                        <Card className="p-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-green-100">
                                    <TrendingUp size={20} className="text-green-600" />
                                </div>
                                <div>
                                    <Text variant="muted" className="text-xs">Actors</Text>
                                    <Text variant="h3">{stats.length}</Text>
                                </div>
                            </div>
                        </Card>
                    </div>
                </div>
            }
        >
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <ActivityFeed limit={50} showFilters={true} />
                </div>
                
                <div className="space-y-4">
                    <Card className="p-4">
                        <Text variant="h4" className="mb-3 flex items-center gap-2">
                            <Users size={16} />
                            Leaderboard
                        </Text>
                        <div className="space-y-2">
                            {stats.map((s, i) => (
                                <div 
                                    key={s.actorName} 
                                    className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0"
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-gray-400 w-5">
                                            #{i + 1}
                                        </span>
                                        <ColorDot
                                            color={s.actorType === 'agent' ? '#818cf8' : '#fbbf24'}
                                            size="sm"
                                        />
                                        <span className="text-sm font-medium">{s.actorName}</span>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-sm font-semibold">{s.totalActions}</span>
                                        <span className="text-xs text-gray-400 ml-1">actions</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>
                    
                    <Card className="p-4">
                        <Text variant="h4" className="mb-3 flex items-center gap-2">
                            <Calendar size={16} />
                            Last 7 Days
                        </Text>
                        <div className="space-y-1">
                            {Object.entries(
                                dailyStats.reduce((acc, s) => {
                                    const day = new Date(s.day).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' });
                                    acc[day] = (acc[day] || 0) + s.actions;
                                    return acc;
                                }, {})
                            ).map(([day, count]) => (
                                <div key={day} className="flex items-center gap-2">
                                    <span className="text-xs text-gray-500 w-16">{day}</span>
                                    <div className="flex-1 bg-gray-100 rounded-full h-2">
                                        <div 
                                            className="bg-blue-500 h-2 rounded-full"
                                            style={{ width: `${Math.min(100, count * 5)}%` }}
                                        />
                                    </div>
                                    <span className="text-xs font-medium w-8 text-right">{count}</span>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            </div>
        </DashboardLayout>
    );
}

-- Test fixture: the PostgreSQL schema of databases created before the app had
-- migrations (as dumped from the original hand-applied SQL files). Tests use it
-- to prove the app still runs on, and correctly adopts, such a database.
-- New databases are created by src/infrastructure/storage/sql/migrate.ts.

--
-- PostgreSQL database dump
--

-- Dumped from database version 18.7
-- Dumped by pg_dump version 18.7

--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

--
-- Name: activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_log (
    id integer NOT NULL,
    action character varying(50) NOT NULL,
    entity_type character varying(20) NOT NULL,
    entity_id character varying(255),
    field_changed character varying(50),
    old_value text,
    new_value text,
    actor_type character varying(20) NOT NULL,
    actor_name character varying(50),
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);

--
-- Name: activity_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activity_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: activity_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activity_log_id_seq OWNED BY public.activity_log.id;

--
-- Name: coverage_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coverage_reports (
    id integer NOT NULL,
    repo_full_name character varying(255) NOT NULL,
    label character varying(100) DEFAULT 'default'::character varying NOT NULL,
    coverage integer,
    commit_sha character varying(40),
    reported_at timestamp with time zone DEFAULT now(),
    CONSTRAINT coverage_reports_coverage_check CHECK (((coverage >= 0) AND (coverage <= 100)))
);

--
-- Name: coverage_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.coverage_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: coverage_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.coverage_reports_id_seq OWNED BY public.coverage_reports.id;

--
-- Name: deep_analysis_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deep_analysis_results (
    id integer NOT NULL,
    repo_full_name text NOT NULL,
    analyzed_at timestamp with time zone DEFAULT now(),
    avg_complexity numeric(10,2),
    max_complexity integer,
    high_complexity_files jsonb,
    duplication_pct numeric(5,2),
    duplicate_blocks jsonb,
    solid_violations jsonb,
    line_coverage numeric(5,2),
    branch_coverage numeric(5,2),
    function_coverage numeric(5,2),
    uncovered_files jsonb,
    vulnerabilities jsonb,
    overall_score integer,
    recommendations jsonb,
    CONSTRAINT deep_analysis_results_overall_score_check CHECK (((overall_score >= 0) AND (overall_score <= 100)))
);

--
-- Name: TABLE deep_analysis_results; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.deep_analysis_results IS 'Stores detailed code analysis results including complexity, duplication, coverage, and security metrics';

--
-- Name: deep_analysis_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.deep_analysis_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: deep_analysis_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.deep_analysis_results_id_seq OWNED BY public.deep_analysis_results.id;

--
-- Name: groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.groups (
    id integer NOT NULL,
    slug character varying(50) NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    color character varying(7) DEFAULT '#6366f1'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: groups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.groups_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: groups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.groups_id_seq OWNED BY public.groups.id;

--
-- Name: repo_apps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repo_apps (
    id integer NOT NULL,
    repo_full_name character varying(255) NOT NULL,
    app_path character varying(500) NOT NULL,
    app_name character varying(150) NOT NULL,
    slug character varying(150) NOT NULL,
    stack character varying(20),
    has_ci boolean,
    has_tests boolean,
    has_readme boolean,
    readme_lines integer,
    loc integer,
    file_count integer,
    docs_quality character varying(20),
    detection_source character varying(30) DEFAULT 'manual'::character varying,
    last_health_check timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    has_unit_tests boolean,
    has_integration_tests boolean,
    has_e2e_tests boolean,
    has_lint_config boolean,
    has_type_checking boolean,
    has_security_scan boolean,
    has_perf_tests boolean,
    test_framework character varying(30),
    e2e_framework character varying(30),
    lint_tool character varying(30),
    CONSTRAINT repo_apps_detection_source_check CHECK (((detection_source)::text = ANY ((ARRAY['manual'::character varying, 'pnpm_workspace'::character varying, 'npm_workspaces'::character varying, 'package_json_workspaces'::character varying, 'turbo'::character varying, 'auto'::character varying, 'path_analysis'::character varying])::text[])))
);

--
-- Name: TABLE repo_apps; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.repo_apps IS 'Sub-applications within monorepos, each with independent health tracking';

--
-- Name: COLUMN repo_apps.repo_full_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repo_apps.repo_full_name IS 'Soft reference to repos.full_name (owner/repo format)';

--
-- Name: COLUMN repo_apps.app_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repo_apps.app_path IS 'Relative path within repo (e.g. apps/hub, ci-ia-core)';

--
-- Name: COLUMN repo_apps.slug; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repo_apps.slug IS 'Globally unique URL-safe identifier';

--
-- Name: repo_apps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.repo_apps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: repo_apps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.repo_apps_id_seq OWNED BY public.repo_apps.id;

--
-- Name: repo_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repo_groups (
    repo_id integer NOT NULL,
    group_id integer NOT NULL,
    added_at timestamp with time zone DEFAULT now()
);

--
-- Name: repo_metrics_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repo_metrics_history (
    id integer NOT NULL,
    repo_id integer NOT NULL,
    full_name character varying(255) NOT NULL,
    snapshot_date date DEFAULT CURRENT_DATE NOT NULL,
    repo_size_kb integer,
    file_count integer,
    loc integer,
    stars integer DEFAULT 0,
    forks integer DEFAULT 0,
    watchers integer DEFAULT 0,
    subscribers_count integer DEFAULT 0,
    open_issues integer DEFAULT 0,
    has_ci boolean,
    has_tests boolean,
    has_readme boolean,
    readme_lines integer,
    has_gitignore boolean,
    has_roadmap boolean,
    docs_file_count integer,
    docs_quality character varying(20),
    language character varying(50),
    is_private boolean,
    is_archived boolean,
    is_fork boolean,
    is_template boolean,
    default_branch character varying(100),
    created_at timestamp without time zone DEFAULT now()
);

--
-- Name: TABLE repo_metrics_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.repo_metrics_history IS 'Daily snapshots of repository metrics for tracking evolution over time';

--
-- Name: COLUMN repo_metrics_history.repo_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repo_metrics_history.repo_id IS 'Reference to repos.id (soft reference, no FK to allow historical data retention)';

--
-- Name: COLUMN repo_metrics_history.snapshot_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repo_metrics_history.snapshot_date IS 'Date of the snapshot (defaults to current date)';

--
-- Name: repo_metrics_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.repo_metrics_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: repo_metrics_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.repo_metrics_history_id_seq OWNED BY public.repo_metrics_history.id;

--
-- Name: repos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repos (
    id integer NOT NULL,
    full_name character varying(255) NOT NULL,
    owner character varying(100) NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    is_private boolean DEFAULT false,
    is_archived boolean DEFAULT false,
    language character varying(50),
    default_branch character varying(100) DEFAULT 'main'::character varying,
    stars integer DEFAULT 0,
    forks integer DEFAULT 0,
    watchers integer DEFAULT 0,
    open_issues integer DEFAULT 0,
    open_prs integer DEFAULT 0,
    last_commit_at timestamp with time zone,
    repo_created_at timestamp with time zone,
    repo_updated_at timestamp with time zone,
    priority character varying(10),
    next_action text,
    blockers text[] DEFAULT '{}'::text[],
    has_readme boolean,
    has_ci boolean,
    has_tests boolean,
    has_gitignore boolean,
    has_roadmap boolean,
    test_coverage integer,
    readme_lines integer,
    stack character varying(20),
    has_unit_tests boolean,
    has_integration_tests boolean,
    has_e2e_tests boolean,
    has_lint_config boolean,
    has_type_checking boolean,
    has_security_scan boolean,
    has_perf_tests boolean,
    test_framework character varying(30),
    e2e_framework character varying(30),
    lint_tool character varying(30),
    docs_quality character varying(20),
    has_docstrings boolean,
    client character varying(100),
    notes text,
    production_urls jsonb DEFAULT '{}'::jsonb,
    readme_content text,
    summary jsonb,
    local_status character varying(20),
    last_health_check timestamp with time zone,
    last_docs_check timestamp with time zone,
    github_cached_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    ci_status character varying(20),
    infra_provider character varying(20),
    production_url text,
    gcp_project character varying(100),
    gcp_service character varying(100),
    gcp_region character varying(50),
    cloudflare_project character varying(100),
    complexity_score integer,
    duplication_pct integer,
    security_issues_count integer DEFAULT 0,
    critical_issues_count integer DEFAULT 0,
    last_deep_analysis timestamp with time zone,
    deep_analysis_status character varying(20),
    is_deleted boolean DEFAULT false,
    deleted_at timestamp with time zone,
    deletion_detected_at timestamp with time zone,
    coverage_updated_at timestamp with time zone,
    coverage_source character varying(20),
    docs_file_count integer DEFAULT 0,
    repo_size_kb integer,
    file_count integer,
    loc integer,
    topics jsonb DEFAULT '[]'::jsonb,
    license_key character varying(50),
    license_name character varying(200),
    homepage text,
    is_fork boolean DEFAULT false,
    parent_repo character varying(255),
    has_issues boolean,
    has_projects boolean,
    has_wiki boolean,
    has_pages boolean,
    has_discussions boolean,
    subscribers_count integer DEFAULT 0,
    is_template boolean DEFAULT false,
    ci_status_url text,
    ci_status_run_at timestamp with time zone,
    ci_status_checked_at timestamp with time zone,
    summary_generated_at timestamp with time zone,
    summary_model character varying(64),
    summary_tokens_in integer,
    summary_tokens_out integer,
    CONSTRAINT repos_ci_status_check CHECK (((ci_status)::text = ANY ((ARRAY['passing'::character varying, 'failing'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT repos_complexity_score_check CHECK (((complexity_score >= 0) AND (complexity_score <= 100))),
    CONSTRAINT repos_coverage_source_check CHECK (((coverage_source)::text = ANY ((ARRAY['ci'::character varying, 'manual'::character varying, 'deep-analysis'::character varying])::text[]))),
    CONSTRAINT repos_deep_analysis_status_check CHECK (((deep_analysis_status)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'completed'::character varying, 'failed'::character varying])::text[]))),
    CONSTRAINT repos_docs_quality_check CHECK (((docs_quality)::text = ANY ((ARRAY['excellent'::character varying, 'good'::character varying, 'needs_work'::character varying, 'missing'::character varying])::text[]))),
    CONSTRAINT repos_duplication_pct_check CHECK (((duplication_pct >= 0) AND (duplication_pct <= 100))),
    CONSTRAINT repos_infra_provider_check CHECK (((infra_provider)::text = ANY ((ARRAY['gcp'::character varying, 'cloudflare'::character varying, 'vercel'::character varying, 'aws'::character varying, 'heroku'::character varying, 'railway'::character varying, 'none'::character varying])::text[]))),
    CONSTRAINT repos_local_status_check CHECK (((local_status)::text = ANY ((ARRAY['reviewed'::character varying, 'pending'::character varying, 'archived'::character varying])::text[]))),
    CONSTRAINT repos_priority_check CHECK (((priority)::text = ANY ((ARRAY['high'::character varying, 'medium'::character varying, 'low'::character varying, 'paused'::character varying])::text[]))),
    CONSTRAINT repos_stack_check CHECK (((stack)::text = ANY ((ARRAY['python'::character varying, 'node'::character varying, 'php'::character varying, 'go'::character varying, 'java'::character varying, 'ruby'::character varying, 'rust'::character varying, 'c'::character varying, 'cpp'::character varying, 'csharp'::character varying, 'swift'::character varying, 'kotlin'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT repos_test_coverage_check CHECK (((test_coverage >= 0) AND (test_coverage <= 100)))
);

--
-- Name: COLUMN repos.ci_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.ci_status IS 'CI workflow status: passing, failing, or unknown';

--
-- Name: COLUMN repos.infra_provider; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.infra_provider IS 'Where the app is deployed: gcp, cloudflare, vercel, etc.';

--
-- Name: COLUMN repos.production_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.production_url IS 'Main production URL for quick access';

--
-- Name: COLUMN repos.gcp_project; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.gcp_project IS 'GCP project ID (e.g., campaign-manager-387617)';

--
-- Name: COLUMN repos.gcp_service; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.gcp_service IS 'Cloud Run service name';

--
-- Name: COLUMN repos.gcp_region; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.gcp_region IS 'GCP region (e.g., us-central1, southamerica-east1)';

--
-- Name: COLUMN repos.cloudflare_project; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.cloudflare_project IS 'Cloudflare Pages/Workers project name';

--
-- Name: COLUMN repos.complexity_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.complexity_score IS 'Overall complexity score (0-100, lower is better)';

--
-- Name: COLUMN repos.duplication_pct; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.duplication_pct IS 'Percentage of duplicate code (0-100)';

--
-- Name: COLUMN repos.security_issues_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.security_issues_count IS 'Total number of security vulnerabilities found';

--
-- Name: COLUMN repos.critical_issues_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.critical_issues_count IS 'Number of critical security vulnerabilities';

--
-- Name: COLUMN repos.last_deep_analysis; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.last_deep_analysis IS 'Timestamp of last deep analysis run';

--
-- Name: COLUMN repos.deep_analysis_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.deep_analysis_status IS 'Current status of deep analysis: pending, running, completed, or failed';

--
-- Name: COLUMN repos.is_deleted; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.is_deleted IS 'True if repo no longer exists on GitHub';

--
-- Name: COLUMN repos.deleted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.deleted_at IS 'When the repo was deleted on GitHub (if known)';

--
-- Name: COLUMN repos.deletion_detected_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.deletion_detected_at IS 'When we detected the repo was deleted';

--
-- Name: COLUMN repos.file_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.file_count IS 'Total number of code files analyzed';

--
-- Name: COLUMN repos.loc; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.loc IS 'Total lines of code (excluding node_modules, dist, etc)';

--
-- Name: COLUMN repos.topics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.topics IS 'Repository tags/keywords from GitHub (array of strings)';

--
-- Name: COLUMN repos.license_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.license_key IS 'License SPDX key (e.g., "mit", "apache-2.0")';

--
-- Name: COLUMN repos.license_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.license_name IS 'License full name (e.g., "MIT License")';

--
-- Name: COLUMN repos.homepage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.homepage IS 'Project homepage URL';

--
-- Name: COLUMN repos.is_fork; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.is_fork IS 'Whether this repository is a fork';

--
-- Name: COLUMN repos.parent_repo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.parent_repo IS 'Parent repository full_name if this is a fork';

--
-- Name: COLUMN repos.has_issues; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.has_issues IS 'GitHub Issues feature enabled';

--
-- Name: COLUMN repos.has_projects; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.has_projects IS 'GitHub Projects feature enabled';

--
-- Name: COLUMN repos.has_wiki; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.has_wiki IS 'GitHub Wiki feature enabled';

--
-- Name: COLUMN repos.has_pages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.has_pages IS 'GitHub Pages feature enabled';

--
-- Name: COLUMN repos.has_discussions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.has_discussions IS 'GitHub Discussions feature enabled';

--
-- Name: COLUMN repos.subscribers_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.subscribers_count IS 'Number of subscribers/watchers (more accurate than watchers)';

--
-- Name: COLUMN repos.is_template; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repos.is_template IS 'Whether this repository is a template repository';

--
-- Name: repos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.repos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: repos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.repos_id_seq OWNED BY public.repos.id;

--
-- Name: services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.services (
    id integer NOT NULL,
    name character varying(150) NOT NULL,
    slug character varying(150) NOT NULL,
    url text,
    provider character varying(30) NOT NULL,
    project character varying(150),
    region character varying(50),
    env character varying(20) DEFAULT 'production'::character varying NOT NULL,
    source_repo_full_name text,
    source_path text,
    last_check_at timestamp with time zone,
    last_check_status character varying(20) DEFAULT 'unknown'::character varying,
    last_check_response_ms integer,
    last_check_http_code integer,
    description text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT services_env_check CHECK (((env)::text = ANY ((ARRAY['production'::character varying, 'staging'::character varying, 'development'::character varying, 'preview'::character varying])::text[]))),
    CONSTRAINT services_last_check_status_check CHECK (((last_check_status)::text = ANY ((ARRAY['healthy'::character varying, 'degraded'::character varying, 'down'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT services_provider_check CHECK (((provider)::text = ANY ((ARRAY['cloudflare'::character varying, 'gcp'::character varying, 'vercel'::character varying, 'aws'::character varying, 'railway'::character varying, 'render'::character varying, 'fly'::character varying, 'heroku'::character varying, 'other'::character varying])::text[])))
);

--
-- Name: TABLE services; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.services IS 'Registry of deployed services with health tracking';

--
-- Name: COLUMN services.slug; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.services.slug IS 'URL-safe unique identifier, auto-generated from name';

--
-- Name: COLUMN services.project; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.services.project IS 'Provider project/account identifier';

--
-- Name: COLUMN services.source_repo_full_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.services.source_repo_full_name IS 'Soft reference to repos.full_name (owner/repo format)';

--
-- Name: COLUMN services.source_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.services.source_path IS 'Subdirectory in monorepo (e.g. "api/")';

--
-- Name: services_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.services_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: services_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.services_id_seq OWNED BY public.services.id;

--
-- Name: activity_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log ALTER COLUMN id SET DEFAULT nextval('public.activity_log_id_seq'::regclass);

--
-- Name: coverage_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_reports ALTER COLUMN id SET DEFAULT nextval('public.coverage_reports_id_seq'::regclass);

--
-- Name: deep_analysis_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deep_analysis_results ALTER COLUMN id SET DEFAULT nextval('public.deep_analysis_results_id_seq'::regclass);

--
-- Name: groups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups ALTER COLUMN id SET DEFAULT nextval('public.groups_id_seq'::regclass);

--
-- Name: repo_apps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repo_apps ALTER COLUMN id SET DEFAULT nextval('public.repo_apps_id_seq'::regclass);

--
-- Name: repo_metrics_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repo_metrics_history ALTER COLUMN id SET DEFAULT nextval('public.repo_metrics_history_id_seq'::regclass);

--
-- Name: repos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repos ALTER COLUMN id SET DEFAULT nextval('public.repos_id_seq'::regclass);

--
-- Name: services id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services ALTER COLUMN id SET DEFAULT nextval('public.services_id_seq'::regclass);

--
-- Name: activity_log activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);

--
-- Name: coverage_reports coverage_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_reports
    ADD CONSTRAINT coverage_reports_pkey PRIMARY KEY (id);

--
-- Name: coverage_reports coverage_reports_repo_full_name_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_reports
    ADD CONSTRAINT coverage_reports_repo_full_name_label_key UNIQUE (repo_full_name, label);

--
-- Name: deep_analysis_results deep_analysis_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deep_analysis_results
    ADD CONSTRAINT deep_analysis_results_pkey PRIMARY KEY (id);

--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);

--
-- Name: groups groups_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_slug_key UNIQUE (slug);

--
-- Name: repo_apps repo_apps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repo_apps
    ADD CONSTRAINT repo_apps_pkey PRIMARY KEY (id);

--
-- Name: repo_apps repo_apps_repo_full_name_app_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repo_apps
    ADD CONSTRAINT repo_apps_repo_full_name_app_path_key UNIQUE (repo_full_name, app_path);

--
-- Name: repo_apps repo_apps_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repo_apps
    ADD CONSTRAINT repo_apps_slug_key UNIQUE (slug);

--
-- Name: repo_groups repo_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repo_groups
    ADD CONSTRAINT repo_groups_pkey PRIMARY KEY (repo_id, group_id);

--
-- Name: repo_metrics_history repo_metrics_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repo_metrics_history
    ADD CONSTRAINT repo_metrics_history_pkey PRIMARY KEY (id);

--
-- Name: repos repos_full_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repos
    ADD CONSTRAINT repos_full_name_key UNIQUE (full_name);

--
-- Name: repos repos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repos
    ADD CONSTRAINT repos_pkey PRIMARY KEY (id);

--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);

--
-- Name: services services_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_slug_key UNIQUE (slug);

--
-- Name: repo_metrics_history unique_repo_snapshot; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repo_metrics_history
    ADD CONSTRAINT unique_repo_snapshot UNIQUE (repo_id, snapshot_date);

--
-- Name: CONSTRAINT unique_repo_snapshot ON repo_metrics_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT unique_repo_snapshot ON public.repo_metrics_history IS 'Prevents duplicate snapshots for the same repo on the same day';

--
-- Name: idx_activity_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_action ON public.activity_log USING btree (action);

--
-- Name: idx_activity_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_actor ON public.activity_log USING btree (actor_type, actor_name);

--
-- Name: idx_activity_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_created ON public.activity_log USING btree (created_at DESC);

--
-- Name: idx_activity_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_entity ON public.activity_log USING btree (entity_type, entity_id);

--
-- Name: idx_activity_entity_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_entity_recent ON public.activity_log USING btree (entity_type, entity_id, created_at DESC);

--
-- Name: idx_deep_analysis_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deep_analysis_date ON public.deep_analysis_results USING btree (analyzed_at DESC);

--
-- Name: idx_deep_analysis_repo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deep_analysis_repo ON public.deep_analysis_results USING btree (repo_full_name);

--
-- Name: idx_groups_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_groups_slug ON public.groups USING btree (slug);

--
-- Name: idx_metrics_history_repo_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metrics_history_repo_date ON public.repo_metrics_history USING btree (repo_id, snapshot_date DESC);

--
-- Name: idx_metrics_history_repo_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metrics_history_repo_id ON public.repo_metrics_history USING btree (repo_id);

--
-- Name: idx_metrics_history_snapshot_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metrics_history_snapshot_date ON public.repo_metrics_history USING btree (snapshot_date);

--
-- Name: idx_repo_apps_repo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repo_apps_repo ON public.repo_apps USING btree (repo_full_name);

--
-- Name: idx_repo_apps_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repo_apps_slug ON public.repo_apps USING btree (slug);

--
-- Name: idx_repos_ci_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repos_ci_status ON public.repos USING btree (ci_status) WHERE (ci_status IS NOT NULL);

--
-- Name: idx_repos_coverage_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repos_coverage_updated ON public.repos USING btree (coverage_updated_at NULLS FIRST) WHERE (test_coverage IS NOT NULL);

--
-- Name: idx_repos_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repos_deleted ON public.repos USING btree (is_deleted) WHERE (is_deleted = true);

--
-- Name: idx_repos_docs_check; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repos_docs_check ON public.repos USING btree (last_docs_check NULLS FIRST);

--
-- Name: idx_repos_docs_quality; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repos_docs_quality ON public.repos USING btree (docs_quality) WHERE (docs_quality IS NOT NULL);

--
-- Name: idx_repos_fork; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repos_fork ON public.repos USING btree (is_fork);

--
-- Name: idx_repos_full_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repos_full_name ON public.repos USING btree (full_name);

--
-- Name: idx_repos_gcp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repos_gcp ON public.repos USING btree (gcp_project) WHERE (gcp_project IS NOT NULL);

--
-- Name: idx_repos_github_cached; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repos_github_cached ON public.repos USING btree (github_cached_at DESC NULLS LAST);

--
-- Name: idx_repos_health_check; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repos_health_check ON public.repos USING btree (last_health_check NULLS FIRST);

--
-- Name: idx_repos_infra; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repos_infra ON public.repos USING btree (infra_provider) WHERE (infra_provider IS NOT NULL);

--
-- Name: idx_repos_license; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repos_license ON public.repos USING btree (license_key);

--
-- Name: idx_repos_needs_ci; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repos_needs_ci ON public.repos USING btree (has_ci) WHERE (has_ci = false);

--
-- Name: idx_repos_needs_readme; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repos_needs_readme ON public.repos USING btree (has_readme) WHERE (has_readme = false);

--
-- Name: idx_repos_needs_roadmap; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repos_needs_roadmap ON public.repos USING btree (has_roadmap) WHERE ((has_roadmap = false) OR (has_roadmap IS NULL));

--
-- Name: idx_repos_needs_tests; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repos_needs_tests ON public.repos USING btree (has_tests) WHERE (has_tests = false);

--
-- Name: idx_repos_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repos_owner ON public.repos USING btree (owner);

--
-- Name: idx_repos_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repos_priority ON public.repos USING btree (priority) WHERE (priority IS NOT NULL);

--
-- Name: idx_repos_stack; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repos_stack ON public.repos USING btree (stack) WHERE (stack IS NOT NULL);

--
-- Name: idx_repos_topics; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repos_topics ON public.repos USING gin (topics);

--
-- Name: idx_repos_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repos_updated ON public.repos USING btree (updated_at DESC);

--
-- Name: idx_services_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_active ON public.services USING btree (is_active) WHERE (is_active = true);

--
-- Name: idx_services_env; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_env ON public.services USING btree (env);

--
-- Name: idx_services_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_provider ON public.services USING btree (provider);

--
-- Name: idx_services_source_repo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_source_repo ON public.services USING btree (source_repo_full_name) WHERE (source_repo_full_name IS NOT NULL);

--
-- Name: groups groups_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER groups_updated_at BEFORE UPDATE ON public.groups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

--
-- Name: repo_apps repo_apps_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER repo_apps_updated_at BEFORE UPDATE ON public.repo_apps FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

--
-- Name: repos repos_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER repos_updated_at BEFORE UPDATE ON public.repos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

--
-- Name: services services_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER services_updated_at BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

--
-- Name: deep_analysis_results deep_analysis_results_repo_full_name_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deep_analysis_results
    ADD CONSTRAINT deep_analysis_results_repo_full_name_fkey FOREIGN KEY (repo_full_name) REFERENCES public.repos(full_name) ON DELETE CASCADE;

--
-- Name: repo_groups repo_groups_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repo_groups
    ADD CONSTRAINT repo_groups_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;

--
-- Name: repo_groups repo_groups_repo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repo_groups
    ADD CONSTRAINT repo_groups_repo_id_fkey FOREIGN KEY (repo_id) REFERENCES public.repos(id) ON DELETE CASCADE;

--
-- PostgreSQL database dump complete
--


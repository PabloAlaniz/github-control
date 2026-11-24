import { describe, it, expect } from 'vitest';
import { majorOf, findManifests, parseManifest } from '@back/lib/signals/manifests';
import { runtimeRelease, runtimeStatus, dedupeRuntimes } from '@back/lib/signals/runtimes';

const names = (r: ReturnType<typeof parseManifest>) => r.dependencies.map(d => `${d.name}@${d.version}:${d.scope}`);

describe('majorOf', () => {
  it('extracts a comparable major', () => {
    expect(majorOf('^18.2.0')).toBe('18');
    expect(majorOf('~0.4.1')).toBe('0.4');
    expect(majorOf('>=3.9,<4')).toBe('3');
    expect(majorOf('v1.9.1')).toBe('1');
    expect(majorOf('0')).toBe('0');
    expect(majorOf('latest')).toBeNull();
    expect(majorOf('')).toBeNull();
  });
});

describe('findManifests', () => {
  it('finds supported manifests, shallowest first, skipping vendored dirs', () => {
    const found = findManifests([
      'packages/api/package.json', 'package.json', 'node_modules/x/package.json', 'README.md',
      'requirements-dev.txt', 'go.mod', 'vendor/y/go.mod', 'a/b/c/d/package.json', '.nvmrc',
      'examples/demo/Cargo.toml', 'crates/core/Cargo.toml', 'pyproject.toml', '.python-version',
    ]);
    expect(findManifests(['Gemfile', 'Gemfile.lock', 'pom.xml', 'app/build.gradle.kts', 'build.gradle', 'src/Api/Api.csproj', 'Directory.Packages.props', 'settings.gradle', 'Api.sln']))
      .toEqual(['build.gradle', 'Directory.Packages.props', 'Gemfile', 'pom.xml', 'app/build.gradle.kts', 'src/Api/Api.csproj']);
    expect(found).toEqual([
      '.nvmrc', '.python-version', 'go.mod', 'package.json', 'pyproject.toml', 'requirements-dev.txt',
      'crates/core/Cargo.toml', 'packages/api/package.json',
    ]);
  });

  it('caps the number of manifests', () => {
    const paths = Array.from({ length: 30 }, (_, i) => `pkg${i}/package.json`);
    expect(findManifests(paths)).toHaveLength(12);
    expect(findManifests(paths, 3)).toHaveLength(3);
  });
});

describe('parseManifest', () => {
  it('ignores unsupported files', () => {
    expect(parseManifest('README.md', '# hi')).toEqual({ dependencies: [], runtimes: [] });
  });

  it('parses package.json dependencies and node engine', () => {
    const result = parseManifest('web/package.json', JSON.stringify({
      dependencies: { react: '^18.2.0', local: { path: '../x' } },
      devDependencies: { vitest: '~1.6.0' },
      peerDependencies: { ignored: '1' },
      engines: { node: '>=20' },
    }));
    expect(names(result)).toEqual(['react@^18.2.0:prod', 'vitest@~1.6.0:dev']);
    expect(result.dependencies[0]).toMatchObject({ ecosystem: 'npm', major: '18', manifest: 'web/package.json' });
    expect(result.runtimes).toEqual([{ name: 'node', version: '>=20', source: 'web/package.json' }]);
  });

  it('tolerates invalid or minimal package.json', () => {
    expect(parseManifest('package.json', '{nope')).toEqual({ dependencies: [], runtimes: [] });
    expect(parseManifest('package.json', '{}')).toEqual({ dependencies: [], runtimes: [] });
    expect(parseManifest('package.json', 'null')).toEqual({ dependencies: [], runtimes: [] });
  });

  it('parses requirements files', () => {
    const result = parseManifest('requirements.txt', [
      '# comment', '', 'Django==4.2.1', 'requests[socks]>=2.31  # inline', 'uvicorn',
      '-r base.txt', '-e .', 'git+https://example.com/x.git', 'pytest ; python_version > "3.8"',
    ].join('\n'));
    expect(names(result)).toEqual(['django@==4.2.1:prod', 'requests@>=2.31:prod', 'uvicorn@*:prod', 'pytest@*:prod']);
    expect(parseManifest('requirements-dev.txt', 'ruff==0.4').dependencies[0].scope).toBe('dev');
  });

  it('parses pyproject.toml (PEP 621)', () => {
    const result = parseManifest('pyproject.toml', `
[project]
name = "app"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.110",
  "pydantic[email]~=2.6; python_version > '3.8'",
]

[project.optional-dependencies]
dev = ["pytest>=8", "ruff"]

[tool.ruff]
line-length = 100
`);
    expect(names(result)).toEqual(['fastapi@>=0.110:prod', 'pydantic@~=2.6:prod', 'pytest@>=8:dev', 'ruff@*:dev']);
    expect(result.runtimes).toEqual([{ name: 'python', version: '>=3.11', source: 'pyproject.toml' }]);
  });

  it('parses pyproject.toml (Poetry)', () => {
    const result = parseManifest('pyproject.toml', `
[tool.poetry.dependencies]
python = "^3.10"
httpx = "^0.27"
sqlalchemy = { version = "^2.0", extras = ["asyncio"] }
local = { path = "../local" }

[tool.poetry.group.dev.dependencies]
pytest = "^8.0"

[tool.poetry.dev-dependencies]
black = "*"
`);
    expect(names(result)).toEqual([
      'httpx@^0.27:prod', 'sqlalchemy@^2.0:prod', 'local@*:prod', 'pytest@^8.0:dev', 'black@*:dev',
    ]);
    expect(result.runtimes[0]).toMatchObject({ name: 'python', version: '^3.10' });
  });

  it('parses go.mod, skipping indirect requirements', () => {
    const result = parseManifest('go.mod', `
module example.com/app

go 1.22.3

require github.com/single/dep v1.0.0

require (
	github.com/gin-gonic/gin v1.9.1
	golang.org/x/text v0.14.0 // indirect
)

replace example.com/x => ../x
`);
    expect(names(result)).toEqual(['github.com/single/dep@v1.0.0:prod', 'github.com/gin-gonic/gin@v1.9.1:prod']);
    expect(result.runtimes).toEqual([{ name: 'go', version: '1.22.3', source: 'go.mod' }]);
  });

  it('parses a Gemfile, with groups as dev', () => {
    const gemfile = `source 'https://rubygems.org'
ruby '3.3.0'
gem 'rails', '~> 7.1.3'   # the framework
gem "pg"
gem 'bootsnap', require: false
gem 'rubocop', '1.60.0', group: :development
gem 'faker', groups: [:development, :test]
group :development, :test do
  gem 'rspec-rails', '~> 6.1'
  platforms :mri do
    gem 'byebug'
  end
end
group :production do
  gem 'puma', '>= 6'
end
gem 'sidekiq'
`;
    const r = parseManifest('Gemfile', gemfile);
    expect(names(r)).toEqual([
      'rails@~> 7.1.3:prod', 'pg@*:prod', 'bootsnap@*:prod', 'rubocop@1.60.0:dev', 'faker@*:dev',
      'rspec-rails@~> 6.1:dev', 'byebug@*:dev', 'puma@>= 6:prod', 'sidekiq@*:prod',
    ]);
    expect(r.dependencies[0]).toMatchObject({ ecosystem: 'rubygems', major: '7', manifest: 'Gemfile' });
  });

  it('parses pom.xml, resolving properties and leaving out managed and plugin dependencies', () => {
    const pom = `<project>
  <properties><jackson.version>2.17.1</jackson.version></properties>
  <dependencyManagement><dependencies>
    <dependency><groupId>org.managed</groupId><artifactId>bom</artifactId><version>1.0</version></dependency>
  </dependencies></dependencyManagement>
  <dependencies>
    <!-- <dependency><groupId>old</groupId><artifactId>gone</artifactId></dependency> -->
    <dependency>
      <groupId>com.fasterxml.jackson.core</groupId>
      <artifactId>jackson-databind</artifactId>
      <version>\${jackson.version}</version>
    </dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
    <dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.10.2</version><scope>test</scope></dependency>
    <dependency><groupId>x</groupId><artifactId>y</artifactId><version>\${unknown}</version></dependency>
    <dependency><artifactId>no-group</artifactId></dependency>
  </dependencies>
  <build><plugins><plugin><dependencies>
    <dependency><groupId>org.plugin</groupId><artifactId>dep</artifactId><version>3.0</version></dependency>
  </dependencies></plugin></plugins></build>
</project>`;
    const r = parseManifest('services/api/pom.xml', pom);
    expect(names(r)).toEqual([
      'com.fasterxml.jackson.core:jackson-databind@2.17.1:prod', 'org.springframework.boot:spring-boot-starter-web@*:prod',
      'org.junit.jupiter:junit-jupiter@5.10.2:dev', 'x:y@${unknown}:prod',
    ]);
    expect(r.dependencies[0].ecosystem).toBe('maven');
  });

  it('parses Gradle build files, Groovy and Kotlin', () => {
    const groovy = `plugins { id 'java' }
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-web:3.3.0'
    api "com.google.guava:guava:33.2.1-jre"
    implementation platform('org.springframework.cloud:spring-cloud-dependencies:2023.0.2')
    runtimeOnly 'org.postgresql:postgresql'
    testImplementation 'org.junit.jupiter:junit-jupiter:5.10.2'
    implementation project(':core')
    classpath 'not.a:dependency:1.0'
}`;
    expect(names(parseManifest('build.gradle', groovy))).toEqual([
      'org.springframework.boot:spring-boot-starter-web@3.3.0:prod', 'com.google.guava:guava@33.2.1-jre:prod',
      'org.springframework.cloud:spring-cloud-dependencies@2023.0.2:prod', 'org.postgresql:postgresql@*:prod',
      'org.junit.jupiter:junit-jupiter@5.10.2:dev',
    ]);
    const kotlin = `dependencies {
    implementation("io.ktor:ktor-server-core:2.3.11")
    androidTestImplementation("androidx.test:runner:1.5.2")
    ksp("com.google.dagger:hilt-compiler:2.51")
}`;
    expect(names(parseManifest('app/build.gradle.kts', kotlin))).toEqual([
      'io.ktor:ktor-server-core@2.3.11:prod', 'androidx.test:runner@1.5.2:dev', 'com.google.dagger:hilt-compiler@2.51:prod',
    ]);
  });

  it('parses .NET project files and central package versions', () => {
    const csproj = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageReference Include="Serilog"><Version>4.0.0</Version></PackageReference>
    <PackageReference Include="Central.Only" />
    <!-- <PackageReference Include="Gone" Version="1.0.0" /> -->
    <PackageReference Update="Newtonsoft.Json" Version="12.0.0" />
    <ProjectReference Include="..\\Core\\Core.csproj" />
  </ItemGroup>
</Project>`;
    const r = parseManifest('src/Api/Api.csproj', csproj);
    expect(names(r)).toEqual(['Newtonsoft.Json@13.0.3:prod', 'Serilog@4.0.0:prod', 'Central.Only@*:prod']);
    expect(r.dependencies[0]).toMatchObject({ ecosystem: 'nuget', major: '13' });
    expect(names(parseManifest('Directory.Packages.props', '<Project><ItemGroup><PackageVersion Include="Polly" Version="8.4.0" /></ItemGroup></Project>')))
      .toEqual(['Polly@8.4.0:prod']);
    expect(names(parseManifest('Lib.fsproj', '<Project />'))).toEqual([]);
  });

  it('parses Cargo.toml', () => {
    const result = parseManifest('Cargo.toml', `
[package]
name = "tool"
version = "0.1.0"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = "1"
local = { path = "../local" }

[dev-dependencies]
insta = "1.38"

[build-dependencies]
cc = "1"
`);
    expect(names(result)).toEqual(['serde@1.0:prod', 'tokio@1:prod', 'local@*:prod', 'insta@1.38:dev', 'cc@1:dev']);
    expect(result.dependencies.every(d => d.ecosystem === 'cargo')).toBe(true);
  });

  it('parses runtime version files', () => {
    expect(parseManifest('.nvmrc', 'v20.11.0\n').runtimes).toEqual([{ name: 'node', version: 'v20.11.0', source: '.nvmrc' }]);
    expect(parseManifest('.node-version', '# pin\n22\n').runtimes[0].version).toBe('22');
    expect(parseManifest('.python-version', '3.12.2').runtimes[0]).toMatchObject({ name: 'python', version: '3.12.2' });
    expect(parseManifest('.nvmrc', '\n').runtimes).toEqual([]);
  });
});

describe('runtimes', () => {
  it('normalizes the release per runtime', () => {
    expect(runtimeRelease('node', 'v20.11.0')).toBe('20');
    expect(runtimeRelease('node', '>=18')).toBe('18');
    expect(runtimeRelease('node', 'lts/iron')).toBeNull();
    expect(runtimeRelease('python', '^3.10')).toBe('3.10');
    expect(runtimeRelease('python', '3')).toBeNull();
    expect(runtimeRelease('go', '1.22.3')).toBe('1');
  });

  it('attaches the end-of-life date when known', () => {
    expect(runtimeStatus({ name: 'node', version: '18', source: '.nvmrc' })).toMatchObject({ release: '18', eolDate: '2025-04-30' });
    expect(runtimeStatus({ name: 'python', version: '3.9.1', source: 'x' }).eolDate).toBe('2025-10-31');
    expect(runtimeStatus({ name: 'node', version: '99', source: 'x' }).eolDate).toBeNull();
    expect(runtimeStatus({ name: 'node', version: 'lts/*', source: 'x' })).toMatchObject({ release: null, eolDate: null });
    expect(runtimeStatus({ name: 'go', version: '1.22', source: 'go.mod' }).eolDate).toBeNull();
  });

  it('keeps one declaration per runtime, preferring the shallowest file', () => {
    const result = dedupeRuntimes([
      { name: 'node', version: '18', source: 'packages/api/package.json' },
      { name: 'node', version: '22', source: '.nvmrc' },
      { name: 'node', version: '20', source: 'package.json' },
      { name: 'python', version: '3.12', source: '.python-version' },
    ]);
    expect(result.map(r => `${r.name}:${r.version}`)).toEqual(['node:22', 'python:3.12']);
  });
});

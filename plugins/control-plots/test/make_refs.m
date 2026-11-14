% Reference data for the Control Plots tests (SPECS 13.3), exported from MATLAB's
% Control System Toolbox. Run from the plugin folder:
%   matlab -batch "run('test/make_refs.m')"
% Writes test/refs/*.csv at full double precision; the CSVs are committed, so the
% tests run without MATLAB.

here = fileparts(mfilename('fullpath'));
out = fullfile(here, 'refs');
if ~exist(out, 'dir'), mkdir(out); end

% name, numerator, denominator, step window T (seconds)
systems = {
  'first',        [1],              [1 1],            6
  'underdamped',  [4],              [1 0.4 4],        30
  'overdamped',   [4],              [1 5 4],          6
  'critical',     [1],              [1 2 1],          6
  'withzero',     [2 1],            [1 2 10],         6
  'nonminphase',  [-1 1],           [1 3 2],          6
  'integrator',   [10],             [1 2 0],          10
  'resonance',    [1],              [1 0.02 1],       600
  'third',        [6],              [1 6 11 6],       6
  'biproper',     [1 2],            [1 1],            6
  'negative',     [-1],             [1 1],            6
  'double_int',   [1],              [1 0 0],          10
  'loop',         [10],             [1 6 5 0],        10
  'lead',         [1 0.2 4],        [1 2 3 1],        20
};

% Discrete time: name, numerator, denominator (in z), step window T (seconds), Ts.
discrete = {
  'd_first',      [0.5],            [1 -0.5],         2,    0.1
  'd_second',     [0.2 0.1],        [1 -1.2 0.5],     4,    0.1
  'd_slow',       [0.02],           [1 -0.98],        20,   0.05
  'd_nmp',        [1 -1.5],         [1 -0.6 0.25],    4,    0.2
  'd_integrator', [0.1],            [1 -1],           3,    0.1
  'd_delay',      [1],              [1 -0.5 0 0],     2,    0.1
};

% c2d of continuous systems: name, numerator, denominator (in s), method, Ts, step window T.
sampled = {
  'zoh_underdamped',  [4],        [1 0.4 4],   'zoh',     0.1,   30
  'zoh_loop',         [10],       [1 6 5 0],   'zoh',     0.1,   10
  'zoh_withzero',     [2 1],      [1 2 10],    'zoh',     0.05,  6
  'tustin_withzero',  [2 1],      [1 2 10],    'tustin',  0.05,  6
  'tustin_lead',      [1 0.2 4],  [1 2 3 1],   'tustin',  0.2,   20
};

w = logspace(-2, 3, 600)';
fid = fopen(fullfile(out, 'systems.csv'), 'w');
fprintf(fid, 'name,num,den,T,Ts,cnum,cden,method\n');
for i = 1:size(systems, 1)
  [name, num, den, T] = systems{i, :};
  fprintf(fid, '%s,%s,%s,%.17g,0,,,\n', name, vec(num), vec(den), T);
  G = tf(num, den);

  [mag, phase] = bode(G, w);
  write(fullfile(out, [name '.bode.csv']), 'w,magdb,phasedeg', ...
    [w, 20 * log10(squeeze(mag)), squeeze(phase)]);

  t = linspace(0, T, 2001)';
  y = step(G, t);
  write(fullfile(out, [name '.step.csv']), 't,y', [t, y]);

  p = pole(G); z = zero(G);
  roots = [ones(numel(p), 1), real(p), imag(p); zeros(numel(z), 1), real(z), imag(z)];
  write(fullfile(out, [name '.roots.csv']), 'pole,re,im', roots);

  [Gm, Pm, Wcg, Wcp] = margin(G);
  write(fullfile(out, [name '.margin.csv']), 'gmdb,pmdeg,wcg,wcp', ...
    [20 * log10(Gm), Pm, Wcg, Wcp]);
end

% Discrete systems, written in z, and continuous ones discretized with c2d (whose
% coefficients are the reference for the plugin's c2d).
rows = discrete;
for i = 1:size(discrete, 1)
  [name, num, den, T, Ts] = discrete{i, :};
  fprintf(fid, '%s,%s,%s,%.17g,%.17g,,,\n', name, vec(num), vec(den), T, Ts);
end
for i = 1:size(sampled, 1)
  [name, num, den, method, Ts, T] = sampled{i, :};
  Gd = c2d(tf(num, den), Ts, method);
  [dn, dd] = tfdata(Gd, 'v');
  fprintf(fid, '%s,%s,%s,%.17g,%.17g,%s,%s,%s\n', name, vec(dn), vec(dd), T, Ts, vec(num), vec(den), method);
  rows(end + 1, :) = {name, dn, dd, T, Ts}; %#ok<AGROW>
end
for i = 1:size(rows, 1)
  [name, num, den, T, Ts] = rows{i, :};
  G = tf(num, den, Ts);

  w = logspace(-2, log10(pi / Ts), 300)';
  [mag, phase] = bode(G, w);
  write(fullfile(out, [name '.bode.csv']), 'w,magdb,phasedeg', ...
    [w, 20 * log10(squeeze(mag)), squeeze(phase)]);

  t = (0:round(T / Ts))' * Ts;
  y = step(G, t);
  write(fullfile(out, [name '.step.csv']), 't,y', [t, y]);

  p = pole(G); z = zero(G);
  roots = [ones(numel(p), 1), real(p), imag(p); zeros(numel(z), 1), real(z), imag(z)];
  write(fullfile(out, [name '.roots.csv']), 'pole,re,im', roots);

  [Gm, Pm, Wcg, Wcp] = margin(G);
  write(fullfile(out, [name '.margin.csv']), 'gmdb,pmdeg,wcg,wcp', ...
    [20 * log10(Gm), Pm, Wcg, Wcp]);
end
fclose(fid);
fprintf('Wrote %d systems to %s\n', size(systems, 1) + size(rows, 1), out);

function s = vec(v)
  s = strjoin(compose('%.17g', v), ' ');
end

function write(file, header, data)
  fid = fopen(file, 'w');
  fprintf(fid, '%s\n', header);
  fmt = [strjoin(repmat({'%.17g'}, 1, size(data, 2)), ','), '\n'];
  fprintf(fid, fmt, data');
  fclose(fid);
end

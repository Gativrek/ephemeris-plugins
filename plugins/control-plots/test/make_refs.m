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

w = logspace(-2, 3, 600)';
fid = fopen(fullfile(out, 'systems.csv'), 'w');
fprintf(fid, 'name,num,den,T\n');
for i = 1:size(systems, 1)
  [name, num, den, T] = systems{i, :};
  fprintf(fid, '%s,%s,%s,%.17g\n', name, strjoin(compose('%.17g', num), ' '), ...
    strjoin(compose('%.17g', den), ' '), T);
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
fclose(fid);
fprintf('Wrote %d systems to %s\n', size(systems, 1), out);

function write(file, header, data)
  fid = fopen(file, 'w');
  fprintf(fid, '%s\n', header);
  fmt = [strjoin(repmat({'%.17g'}, 1, size(data, 2)), ','), '\n'];
  fprintf(fid, fmt, data');
  fclose(fid);
end
